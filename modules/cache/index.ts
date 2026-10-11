// modules/cache/index.ts
// 缓存模块（通用能力）：内存策略（默认）/ 无缓存策略；Redis 待补。
// 语义见 kernel/contracts/cache.contract.ts。

import type { CacheProvider } from '@kernel/contracts/cache.contract.js';
import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import { Tokens } from '@kernel/registry.js';

interface Entry {
  value: unknown;
  expiresAt: number; // epoch ms；0 = 不过期
}

/** 内存缓存（带 TTL 与前缀失效）；单进程形态 */
export function createMemoryCache(): CacheProvider {
  const store = new Map<string, Entry>();
  return {
    name: 'memory',
    async get<T>(key: string): Promise<T | null> {
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt !== 0 && e.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return e.value as T;
    },
    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
      store.set(key, {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0,
      });
    },
    async invalidate(prefix: string): Promise<void> {
      for (const k of [...store.keys()]) {
        if (k.startsWith(prefix)) store.delete(k);
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

export interface CacheModuleOptions {
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
        dialect === 'none' ? createNullCache() : createMemoryCache()
      );
    },
  };
}
