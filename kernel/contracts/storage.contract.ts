// kernel/contracts/storage.contract.ts
// 存储抽象（策略接口）：契约里没有 SQL、没有表名、没有方言字样。
// 依据：engineering-spec 4.3。
// 事务语义（v1.1 定死，所有方言驱动必须一致实现）：
//   1. transaction(fn) 开启一个事务并执行 fn；fn 内所有操作要么全部生效，要么全部回滚。
//   2. 事务可重入：fn 内再次调用 transaction()（或经过它间接调用）不开启新事务，
//      而是加入当前事务（方言可用 SAVEPOINT 实现部分回滚边界），由最外层决定最终提交。
//   3. 事务与调用方解耦：fn 抛错则整体回滚并把错误原样抛给调用方。
//   4. 读写权限由驱动自行判断：只读操作允许走无事务快速路径，但必须保证一致性视图。

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
  /** 满足条件的行数（不取回数据；分页统计必须用它，禁止 find 后取 length） */
  count(spec: QuerySpec): Promise<number>;
  insert<T>(table: string, data: T): Promise<T>;
  update<T>(table: string, id: string, patch: Partial<T>): Promise<T>;
  delete(table: string, id: string): Promise<void>;
}

export interface StorageDriver {
  readonly dialect: Dialect;
  migrate(): Promise<void>;
  /** 语义见文件头"事务语义"；实现必须支持重入 */
  transaction<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
