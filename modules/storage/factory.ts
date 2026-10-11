// modules/storage/factory.ts
// 策略工厂：唯一知道"有哪些方言"的地方。
// 允许且仅允许此文件出现方言分支（见 scripts/check-no-dialect.mjs 的 ALLOW 列表）。

import type { Dialect, StorageDriver } from '@kernel/contracts/storage.contract.js';
import { createSqliteDriver } from './drivers/sqlite.driver.js';

export interface StorageConfig {
  dialect: Dialect;
  /** 连接串/文件路径。SQLite 为文件路径或 ':memory:' */
  url?: string;
}

/** 方言 → 驱动构造（策略表：加方言只改这一处） */
const builders: Record<Dialect, (cfg: StorageConfig) => StorageDriver> = {
  sqlite: (cfg) => createSqliteDriver({ file: cfg.url ?? './data/app.db' }),
  postgres: () => {
    throw new Error(
      '[storage] postgres 策略未实现（阶段三按需加）。契约已就绪，驱动为待补实现。'
    );
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
const IMPLEMENTED: ReadonlySet<Dialect> = new Set<Dialect>(['sqlite']);

/** 是否已实现某方言驱动 */
export function isDialectAvailable(dialect: Dialect): boolean {
  return IMPLEMENTED.has(dialect);
}
