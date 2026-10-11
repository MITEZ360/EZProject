// modules/storage/schema/columns.ts
// 策略表（逻辑类型 × 方言）——消灭类型映射的 if/else。
// 术语见 design.md 5.2 / engineering-spec 5.3。
//
// 设计说明：本文件只做"逻辑类型 → 物理类型名"的映射，不依赖任何 ORM。
// 这样存储契约保持 ORM 无关；将来若引入 Drizzle，只需在此把 ColumnSpec 映射到
// drizzle 的列构造器（见文件末尾 sqliteDrizzleColumns），改动集中一处。

/** 逻辑类型（内核语义层） */
export type LogicalType = 'uuid' | 'shortId' | 'text' | 'int' | 'json' | 'timestamp' | 'bool';

/** 方言 */
export type Dialect = 'sqlite' | 'postgres' | 'mysql';

/** 物理列描述（方言无关的中间表示） */
export interface ColumnSpec {
  /** 物理列名（下划线命名） */
  name: string;
  dialect: Dialect;
  kind: LogicalType;
  /** 物理类型名（该方言下） */
  physical: string;
  /** 是否需要 JSON 序列化（应用层） */
  jsonEncoded: boolean;
}

type ColumnFn = (name: string) => ColumnSpec;

const spec = (
  name: string,
  dialect: Dialect,
  kind: LogicalType,
  physical: string,
  jsonEncoded = false
): ColumnSpec => ({ name, dialect, kind, physical, jsonEncoded });

/**
 * 二维策略表：strategies[logicalType][dialect] -> (name) => ColumnSpec
 * 加类型或加方言只改这一处。
 *
 * 约定（engineering-spec 6.5）：
 *   - uuid / shortId：文本（应用层生成）
 *   - json：SQLite/PG 用 jsonb/json，MySQL 用 json；SQLite 落 text
 *   - timestamp：统一 epoch 毫秒整数
 *   - bool：整数 0/1（SQLite）或 boolean
 */
export const strategies: Record<LogicalType, Record<Dialect, ColumnFn>> = {
  uuid: {
    sqlite: (n) => spec(n, 'sqlite', 'uuid', 'TEXT'),
    postgres: (n) => spec(n, 'postgres', 'uuid', 'UUID'),
    mysql: (n) => spec(n, 'mysql', 'uuid', 'CHAR(36)'),
  },
  shortId: {
    sqlite: (n) => spec(n, 'sqlite', 'shortId', 'TEXT'),
    postgres: (n) => spec(n, 'postgres', 'shortId', 'VARCHAR(16)'),
    mysql: (n) => spec(n, 'mysql', 'shortId', 'VARCHAR(16)'),
  },
  text: {
    sqlite: (n) => spec(n, 'sqlite', 'text', 'TEXT'),
    postgres: (n) => spec(n, 'postgres', 'text', 'TEXT'),
    mysql: (n) => spec(n, 'mysql', 'text', 'TEXT'),
  },
  int: {
    sqlite: (n) => spec(n, 'sqlite', 'int', 'INTEGER'),
    postgres: (n) => spec(n, 'postgres', 'int', 'BIGINT'),
    mysql: (n) => spec(n, 'mysql', 'int', 'BIGINT'),
  },
  json: {
    sqlite: (n) => spec(n, 'sqlite', 'json', 'TEXT', true),
    postgres: (n) => spec(n, 'postgres', 'json', 'JSONB', true),
    mysql: (n) => spec(n, 'mysql', 'json', 'JSON', true),
  },
  timestamp: {
    sqlite: (n) => spec(n, 'sqlite', 'timestamp', 'INTEGER'),
    postgres: (n) => spec(n, 'postgres', 'timestamp', 'BIGINT'),
    mysql: (n) => spec(n, 'mysql', 'timestamp', 'BIGINT'),
  },
  bool: {
    sqlite: (n) => spec(n, 'sqlite', 'bool', 'INTEGER'),
    postgres: (n) => spec(n, 'postgres', 'bool', 'BOOLEAN'),
    mysql: (n) => spec(n, 'mysql', 'bool', 'TINYINT(1)'),
  },
};

/** 统一入口：按"逻辑类型 + 方言"取列描述 */
export const column = (type: LogicalType, name: string, dialect: Dialect): ColumnSpec =>
  strategies[type][dialect](name);
