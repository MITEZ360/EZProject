// modules/storage/factory.ts
// 策略工厂：唯一知道"有哪些方言"的地方。
// 允许且仅允许此文件出现方言分支（见 scripts/check-no-dialect.mjs 的 ALLOW 列表）。

import type { Dialect, StorageDriver } from '@kernel/contracts/storage.contract.js';
import { createSqliteDriver } from './drivers/sqlite.driver.js';
import { createPostgresDriver } from './drivers/postgres.driver.js';

export interface StorageConfig {
  dialect: Dialect;
  /** 连接串 / 文件路径。SQLite 为文件路径或 ':memory:'；PG 为 postgres:// 连接串 */
  url?: string;
}

/** 方言 → 驱动构造（策略表：加方言只改这一处） */
const builders: Record<Dialect, (cfg: StorageConfig) => StorageDriver> = {
  sqlite: (cfg) => createSqliteDriver({ file: cfg.url ?? './data/app.db' }),
  postgres: (cfg) => {
    const url = cfg.url ?? process.env['DATABASE_URL'];
    if (!url) {
      throw new Error('[storage] postgres 方言需要连接串（config.url 或环境变量 DATABASE_URL）');
    }
    return createPostgresDriver({ url });
  },
  mysql: () => {
    throw new Error(
      '[storage] mysql 策略未实现（阶段三按需加）。契约已就绪，驱动为待补实现。'
    );
  },
};

export function createStorageDriver(cfg: StorageConfig): StorageDriver {
  return builders[cfg.dialect](cfg);
}

/** 已实现的方言（供自检/日志使用；与 builders 保持一致） */
const IMPLEMENTED: ReadonlySet<Dialect> = new Set<Dialect>(['sqlite', 'postgres']);

/** 是否已实现某方言驱动 */
export function isDialectAvailable(dialect: Dialect): boolean {
  return IMPLEMENTED.has(dialect);
}
