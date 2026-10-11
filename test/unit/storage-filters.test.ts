// test/unit/storage-filters.test.ts
// 存储契约 v2：QueryFilter 组合过滤（含 JSON 字段点路径）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Dialect, StorageDriver } from '@kernel/contracts/storage.contract.js';
import { createStorageDriver } from '@modules/storage/factory.js';

// 同 storage.test.ts：契约测试跑在**所有已实现方言**上。
// 这组尤其关键——JSON 查询的方言差异最大（SQLite 的 json_extract 保留类型，
// PG 的 ->> 一律返回 text，不 cast 会按字典序比较）。
const DIALECTS: Array<{ name: Dialect; url: string }> = [{ name: 'sqlite', url: ':memory:' }];
if (process.env['TEST_PG_URL']) {
  DIALECTS.push({ name: 'postgres', url: process.env['TEST_PG_URL'] });
}

let driver: StorageDriver;

const SEED = (i: number): Record<string, unknown> => ({
  id: `e${i}`,
  tenantId: 't',
  type: 'products',
  locale: 'zh',
  status: 'published',
  data: { price: i * 10, tags: i % 2 === 0 ? ['hot', 'x'] : ['cold'], name: `商品${i}` },
  createdAt: i,
  updatedAt: i,
  deletedAt: 0,
});

describe.each(DIALECTS)('$name：QueryFilter（JSON 字段点路径）', (d) => {
  beforeEach(async () => {
    driver = createStorageDriver({ dialect: d.name, url: d.url });
    if (d.name !== 'sqlite') {
      // PG 是持久库：先清表保证用例间隔离
      await driver.transaction((tx) => tx.exec('DROP TABLE IF EXISTS entries, content_types CASCADE'));
    }
    await driver.migrate();
    for (let i = 1; i <= 5; i++) {
      await driver.transaction((tx) => tx.insert('entries', SEED(i)));
    }
  });

  afterEach(async () => {
    await driver.close();
  });

  it('eq / ne', async () => {
    const r1 = await driver.transaction((tx) =>
      tx.find<{ id: string }>({ table: 'entries', filters: [{ field: 'data.price', op: 'eq', value: 30 }] })
    );
    expect(r1.map((r) => r.id)).toEqual(['e3']);

    const r2 = await driver.transaction((tx) =>
      tx.find<{ id: string }>({ table: 'entries', filters: [{ field: 'data.price', op: 'ne', value: 30 }] })
    );
    expect(r2).toHaveLength(4);
  });

  it('gt / lte 范围（决策 #26：number/date 范围查询）', async () => {
    const r1 = await driver.transaction((tx) =>
      tx.find<{ id: string }>({
        table: 'entries',
        filters: [{ field: 'data.price', op: 'gt', value: 20 }],
      })
    );
    expect(r1.map((r) => r.id)).toEqual(['e3', 'e4', 'e5']);

    const r2 = await driver.transaction((tx) =>
      tx.find<{ id: string }>({
        table: 'entries',
        filters: [{ field: 'data.price', op: 'lte', value: 20 }],
      })
    );
    expect(r2.map((r) => r.id)).toEqual(['e1', 'e2']);
  });

  it('in / contains（数组包含）', async () => {
    const r1 = await driver.transaction((tx) =>
      tx.find<{ id: string }>({
        table: 'entries',
        filters: [{ field: 'status', op: 'in', value: ['published'] }],
      })
    );
    expect(r1).toHaveLength(5);

    const r2 = await driver.transaction((tx) =>
      tx.find<{ id: string }>({
        table: 'entries',
        filters: [{ field: 'data.tags', op: 'contains', value: 'hot' }],
      })
    );
    expect(r2.map((r) => r.id)).toEqual(['e2', 'e4']); // 偶数行有 'hot'

    const r3 = await driver.transaction((tx) =>
      tx.find<{ id: string }>({
        table: 'entries',
        filters: [{ field: 'data.name', op: 'contains', value: '商品3' }],
      })
    );
    expect(r3.map((r) => r.id)).toEqual(['e3']);
  });

  it('where 与 filters AND 组合；count 同样支持 filters', async () => {
    const rows = await driver.transaction((tx) =>
      tx.find<{ id: string }>({
        table: 'entries',
        where: { tenantId: 't' },
        filters: [
          { field: 'data.price', op: 'gte', value: 20 },
          { field: 'data.price', op: 'lt', value: 50 },
        ],
      })
    );
    expect(rows.map((r) => r.id)).toEqual(['e2', 'e3', 'e4']);

    const n = await driver.transaction((tx) =>
      tx.count({ table: 'entries', filters: [{ field: 'data.price', op: 'gt', value: 10 }] })
    );
    expect(n).toBe(4);
  });

  it('in 条件传非数组 → E_STORAGE 明确报错', async () => {
    await expect(
      driver.transaction((tx) =>
        tx.find({ table: 'entries', filters: [{ field: 'status', op: 'in', value: 'published' }] })
      )
    ).rejects.toThrow('必须为数组');
  });
});
