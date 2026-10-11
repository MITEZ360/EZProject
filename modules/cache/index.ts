// modules/cache/index.ts
// 缓存模块（通用能力）：内存 LRU 策略（默认）/ 无缓存策略；Redis 待补。
// 语义见 kernel/contracts/cache.contract.ts。
//
// 单机定位：不引入独立服务（Redis）与新的原生依赖。内存策略**必须有界**——
// 缓存 key 基数不受调用方约束（HTTP 层 key 含完整 query string），无界 Map
// 可被外部请求撑爆内存（DoS）。故本实现为「条数上限 + 近似字节上限」的 LRU。

import type { CacheProvider } from '@kernel/contracts/cache.contract.js';
import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import { Tokens } from '@kernel/registry.js';

interface Entry {
  value: unknown;
  expiresAt: number; // epoch ms；0 = 不过期
  /** 近似占用（JSON 长度估算），用于字节上限淘汰 */
  bytes: number;
}

export interface MemoryCacheOptions {
  /** 最大条目数（超出按 LRU 淘汰），默认 1000 */
  maxEntries?: number;
  /** 近似最大占用字节（按 JSON 序列化长度估算），默认 8 MiB */
  maxBytes?: number;
}

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * 内存缓存（LRU + TTL + 前缀失效）。单进程形态。
 *
 * 借助 Map 的插入序实现 LRU：头部最旧、尾部最新。
 * - `get` 命中 → 移到尾部（标记最近使用）
 * - `set` 超出上限 → 先清过期，再从头部淘汰，直到满足双上限
 */
export function createMemoryCache(options: MemoryCacheOptions = {}): CacheProvider {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const store = new Map<string, Entry>();
  let bytes = 0;

  const drop = (key: string): void => {
    const e = store.get(key);
    if (e) {
      bytes -= e.bytes;
      store.delete(key);
    }
  };

  /**
   * 淘汰到满足双上限。无压力时 O(1)（不扫描）。
   * 不做全表过期清扫：条目 set 后若无人 get，会随新写入自然漂向头部——
   * 过期者天然排在淘汰序列最前，故纯 LRU 足以覆盖，无需额外 O(n) 扫描。
   */
  const evict = (): void => {
    while (store.size > maxEntries || bytes > maxBytes) {
      const oldest = store.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      drop(oldest);
    }
  };

  /** 近似大小：写入路径（仅 miss 时发生）成本可接受；无法序列化按 0 计，不因此拒绝写入 */
  const sizeOf = (value: unknown): number => {
    try {
      return JSON.stringify(value)?.length ?? 0;
    } catch {
      return 0;
    }
  };

  return {
    name: 'memory',

    async get<T>(key: string): Promise<T | null> {
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt !== 0 && e.expiresAt <= Date.now()) {
        drop(key);
        return null;
      }
      // 命中：移到尾部（Map 保序 → 最近使用在尾）
      store.delete(key);
      store.set(key, e);
      return e.value as T;
    },

    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
      drop(key); // 覆盖写：先扣旧占用，避免重复计容
      const size = sizeOf(value);
      store.set(key, {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0,
        bytes: size,
      });
      bytes += size;
      evict();
    },

    async invalidate(prefix: string): Promise<void> {
      for (const k of [...store.keys()]) {
        if (k.startsWith(prefix)) drop(k);
      }
    },
  };
}

/** 不缓存（默认关闭缓存时使用；行为对调用方透明） */
export function createNullCache(): CacheProvider {
  return {
    name: 'none',
    async get<T>(): Promise<T | null> {
      return null;
    },
    async set(): Promise<void> {
      /* no-op */
    },
    async invalidate(): Promise<void> {
      /* no-op */
    },
  };
}

export interface CacheModuleOptions extends MemoryCacheOptions {
  /** 'memory' | 'none' | 'redis'（redis 待补） */
  dialect?: 'memory' | 'none' | 'redis';
}

export function cacheModule(options: CacheModuleOptions = {}): PlatformModule {
  return {
    name: 'cache',
    async setup({ registry }): Promise<void> {
      const dialect = options.dialect ?? 'memory';
      if (dialect === 'redis') {
        throw new Error('[cache] redis 策略未实现（阶段三按需补）。契约已就绪。');
      }
      registry.provide<CacheProvider>(
        Tokens.Cache,
        dialect === 'none'
          ? createNullCache()
          : createMemoryCache({ maxEntries: options.maxEntries, maxBytes: options.maxBytes })
      );
    },
  };
}
