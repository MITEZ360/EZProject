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

/**
 * 可移植列类型：模块私有表声明列时**只能**用这些逻辑类型，
 * 物理落地（text/varchar、bigint/integer、json/jsonb、boolean/tinyint）由驱动按方言决定。
 *
 * 为什么必须收归契约：模块手写物理类型是"换配置可切库"最隐蔽的杀手——
 * SQLite 的 `INTEGER` 是 64 位动态类型，PG 的 `integer` 只有 32 位，
 * 同一份 DDL 在一个方言上正常、在另一个方言上直接溢出（实测：epoch 毫秒写 PG
 * 报 `out of range for type integer`）。物理类型一旦离开契约的管辖范围，
 * 就会以"只在某个方言上炸"的形式回归——而 SQLite 侧的测试**永远发现不了**。
 */
export type PortableColumnType = 'text' | 'int' | 'json' | 'timestamp' | 'bool';

/** 模块私有表的列声明 */
export interface ColumnDef {
  /** 物理列名（下划线命名） */
  name: string;
  type: PortableColumnType;
  primaryKey?: boolean;
  notNull?: boolean;
  /** 字面量默认值（数字或字符串）。**不接受 SQL 片段**——既防注入，也防方言语法外泄 */
  default?: number | string;
}

/** 模块私有表的索引声明 */
export interface IndexDef {
  name: string;
  /** 列名列表；前缀 `-` 表示该列降序（如 `['tenant_id', '-occurred_at']`） */
  columns: string[];
  unique?: boolean;
}

/** 模块私有表声明：建表 + 登记表结构一步完成 */
export interface TableDef {
  table: string;
  columns: ColumnDef[];
  indexes?: IndexDef[];
  /**
   * 应用字段 → 物理列名的映射与 JSON 列声明（语义同 `TableSchema`）。
   * 建表时一并登记，避免"建了表却忘了登记"导致读写报未声明。
   */
  schema?: TableSchema;
}

export interface StorageDriver {
  readonly dialect: Dialect;
  migrate(): Promise<void>;
  /** 语义见文件头"事务语义"；实现必须支持重入 */
  transaction<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T>;
  /** 模块私有表登记（模块 setup 建 DDL 后调用；未登记的表禁止读写——防拼错表名） */
  registerTable(name: string, schema: TableSchema): void;
  /**
   * 创建模块私有表：DDL 由存储层按方言生成（物理类型、默认值、索引语法全部方言无关化），
   * 并同时登记表结构（等价于 `registerTable`）。
   *
   * 为什么要有它：模块自己拼 DDL，就必须知道物理类型与方言语法——而这正是
   * "只在某个方言上暴露的缺陷"的来源。声明式建表把两者都收归存储层。
   *
   * 语义：**幂等**（重复调用等价于 `IF NOT EXISTS`；表已存在时不改动既有结构）。
   * 边界：无法声明式表达的表（SQLite FTS5 虚拟表、PG tsvector 表等）仍走 `exec`
   * 原生通道——逃生舱保留，但不再是默认路径。
   */
  createTable(def: TableDef): Promise<void>;
  close(): Promise<void>;
}
