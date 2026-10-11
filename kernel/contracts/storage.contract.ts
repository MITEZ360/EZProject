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
  /** 等值条件（快捷方式） */
  where?: Record<string, unknown>;
  /** 组合过滤（与 where 求 AND）。字段支持点路径访问 JSON 字段：'data.price'（决策 #26 查询效率策略） */
  filters?: QueryFilter[];
  orderBy?: { field: string; dir: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}

/** 条件过滤：op 语义由契约定义，方言各自落地（SQLite 用 json_extract，PG 用 ->>） */
export interface QueryFilter {
  /** 列名（顶层物理列）或点路径（JSON 字段，如 'data.price'） */
  field: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
  value: unknown;
}

export interface StorageTx {
  find<T>(spec: QuerySpec): Promise<T[]>;
  findOne<T>(spec: QuerySpec): Promise<T | null>;
  /** 满足条件的行数（不取回数据；分页统计必须用它，禁止 find 后取 length） */
  count(spec: QuerySpec): Promise<number>;
  /**
   * 执行原生语句（DDL / 方言特有写操作），**支持参数绑定**（务必绑参，勿拼串）。
   * **仅限模块私有表**（audit/settings/media/authz/search 等模块自建的表）；
   * 共享业务数据（entries 等）一律走 find/insert/update/delete——禁止绕过数据抽象。
   */
  exec(sql: string, params?: unknown[]): Promise<void>;
  /**
   * 原生查询（返回行），支持参数绑定。用途与边界同 exec：**仅限模块私有表**，
   * 且限于 `QuerySpec` 无法表达的方言特性（如 SQLite FTS5 的 `MATCH`）。
   */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  insert<T>(table: string, data: T): Promise<T>;
  update<T>(table: string, id: string, patch: Partial<T>): Promise<T>;
  delete(table: string, id: string): Promise<void>;
}

/** 模块私有表的结构声明（列名映射 + JSON 列），语义同驱动内置表 */
export interface TableSchema {
  /** 应用对象键 → 物理列名（如 tenantId → tenant_id）；未声明的键按原样使用 */
  columns?: Record<string, string>;
  /** JSON 列（写入序列化 / 读取解析；其余列原样） */
  jsonColumns?: string[];
}

export interface StorageDriver {
  readonly dialect: Dialect;
  migrate(): Promise<void>;
  /** 语义见文件头"事务语义"；实现必须支持重入 */
  transaction<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T>;
  /** 模块私有表登记（模块 setup 建 DDL 后调用；未登记的表禁止读写——防拼错表名） */
  registerTable(name: string, schema: TableSchema): void;
  close(): Promise<void>;
}
