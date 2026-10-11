// 内存 LRU 缓存的边界行为：容量上限、LRU 保鲜、TTL、前缀失效、覆盖写。
// 背景：原实现为无上限 Map（key 基数不受调用方约束 → 可被外部撑爆内存）。

import { describe, it, expect } from 'vitest';
import { createMemoryCache, createNullCache } from '@modules/cache/index.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('memory LRU 缓存', () => {
  it('基本读写 + TTL 过期', async () => {
    const c = createMemoryCache();
    await c.set('k', { a: 1 }, 60);
    expect(await c.get<{ a: number }>('k')).toEqual({ a: 1 });

    await c.set('short', 'v', 0.03); // 30ms
    expect(await c.get('short')).toBe('v');
    await sleep(60);
    expect(await c.get('short')).toBeNull(); // 过期即视为不存在
  });

  it('无 TTL（不传）不自动过期', async () => {
    const c = createMemoryCache();
    await c.set('forever', 1);
    await sleep(30);
    expect(await c.get('forever')).toBe(1);
  });

  it('条数上限：超出淘汰最久未使用（LRU）', async () => {
    const c = createMemoryCache({ maxEntries: 3 });
    await c.set('a', 1);
    await c.set('b', 2);
    await c.set('c', 3);
    await c.set('d', 4); // 超限 → 淘汰最旧的 a

    expect(await c.get('a')).toBeNull();
    expect(await c.get('b')).toBe(2);
    expect(await c.get('c')).toBe(3);
    expect(await c.get('d')).toBe(4);
  });

  it('get 命中 = 保鲜（不会被优先淘汰）', async () => {
    const c = createMemoryCache({ maxEntries: 3 });
    await c.set('a', 1);
    await c.set('b', 2);
    await c.set('c', 3);
    await c.get('a'); // a 变为最近使用 → 顺序成为 b, c, a
    await c.set('d', 4); // 淘汰 b，而非 a

    expect(await c.get('a')).toBe(1); // 被保鲜，仍在
    expect(await c.get('b')).toBeNull(); // 真正最旧的被淘汰
    expect(await c.get('c')).toBe(3);
    expect(await c.get('d')).toBe(4);
  });

  it('字节上限：大值触发淘汰（条数未满也会回收）', async () => {
    const c = createMemoryCache({ maxEntries: 100, maxBytes: 100 });
    await c.set('k1', 'x'.repeat(50)); // ≈52 字节
    await c.set('k2', 'y'.repeat(50)); // 累计 ≈104 > 100 → 淘汰 k1

    expect(await c.get('k1')).toBeNull();
    expect(await c.get('k2')).toBe('y'.repeat(50));
  });

  it('过期条目先出（最旧者先淘汰），不误杀有效数据', async () => {
    const c = createMemoryCache({ maxEntries: 2 });
    await c.set('stale', 'old', 0.03); // 最早写入 → 必在头部
    await c.set('keep1', 'a');
    await sleep(60); // stale 已过期（未被 get，滞留 Map 中）

    await c.set('keep2', 'b'); // 超限 → 淘汰头部（正是 stale）

    expect(await c.get('stale')).toBeNull();
    expect(await c.get('keep1')).toBe('a'); // 有效数据保住
    expect(await c.get('keep2')).toBe('b');
  });

  it('覆盖同 key 不重复计容（不因反复写而挤出其他条目）', async () => {
    const c = createMemoryCache({ maxEntries: 3 });
    await c.set('hot', 'v1');
    for (let i = 0; i < 20; i++) await c.set('hot', `v${i}`);
    await c.set('other1', 1);
    await c.set('other2', 2);

    expect(await c.get('other1')).toBe(1); // 未被 'hot' 的重复写挤掉
    expect(await c.get('other2')).toBe(2);
    expect(await c.get('hot')).toBe('v19');
  });

  it('前缀失效：只清匹配前缀', async () => {
    const c = createMemoryCache();
    await c.set('content:t1:a', 1);
    await c.set('content:t1:b', 2);
    await c.set('content:t2:a', 3);

    await c.invalidate('content:t1:');

    expect(await c.get('content:t1:a')).toBeNull();
    expect(await c.get('content:t1:b')).toBeNull();
    expect(await c.get('content:t2:a')).toBe(3); // 其他租户不受影响
  });

  it('无法序列化的值也能缓存（不因估算失败而拒绝）', async () => {
    const c = createMemoryCache();
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic['self'] = cyclic;
    await c.set('cyclic', cyclic);
    expect(await c.get('cyclic')).toBe(cyclic);
  });

  it('单条超过字节上限：被淘汰（不缓存超大对象）', async () => {
    const c = createMemoryCache({ maxBytes: 10 });
    await c.set('huge', 'z'.repeat(1000));
    expect(await c.get('huge')).toBeNull(); // 明确不占空间
  });

  it('抗 key 泛滥：10 万个不同 query 只保留最近上限条（原无界 Map 会被外部撑爆）', async () => {
    const c = createMemoryCache({ maxEntries: 1000 });
    const keyOf = (i: number): string => `content:t1:/api/v1/posts?offset=${i}`;

    const started = Date.now();
    for (let i = 0; i < 100_000; i++) await c.set(keyOf(i), { i });
    const elapsed = Date.now() - started;

    expect(await c.get(keyOf(99_999))).toEqual({ i: 99_999 }); // 最新
    expect(await c.get(keyOf(99_000))).toEqual({ i: 99_000 }); // 窗口最旧仍在
    expect(await c.get(keyOf(98_999))).toBeNull(); // 窗口外 → 已淘汰
    expect(await c.get(keyOf(0))).toBeNull();
    expect(elapsed).toBeLessThan(5_000); // 热路径无 O(n) 退化
  });
});

describe('null 缓存（透明降级）', () => {
  it('写入后读回为 null，且不抛错', async () => {
    const c = createNullCache();
    await c.set('k', 1, 60);
    expect(await c.get('k')).toBeNull();
    await c.invalidate('k'); // no-op，不抛
    expect(c.name).toBe('none');
  });
});
