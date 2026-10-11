// kernel/contracts/storage.contract.ts
// 存储抽象（策略接口）：契约里没有 SQL、没有表名、没有方言字样。
// 依据：engineering-spec 4.3。

export type Dialect = 'sqlite' | 'postgres' | 'mysql';

export interface QuerySpec {
  table: string;
  /** 方言无关条件 */
  where?: Record<string, unknown>;
  orderBy?: { field: string; dir: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}

export interface StorageTx {
  find<T>(spec: QuerySpec): Promise<T[]>;
  findOne<T>(spec: QuerySpec): Promise<T | null>;
  insert<T>(table: string, data: T): Promise<T>;
  update<T>(table: string, id: string, patch: Partial<T>): Promise<T>;
  delete(table: string, id: string): Promise<void>;
}

export interface StorageDriver {
  readonly dialect: Dialect;
  migrate(): Promise<void>;
  transaction<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
