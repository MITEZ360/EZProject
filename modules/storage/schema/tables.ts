// modules/storage/schema/tables.ts
// 表结构声明 + 结构注册表 + 行映射——**方言无关**的部分，供各存储驱动复用。
//
// 切分原则：
//  - 这里只管"列名怎么映射""哪列是 JSON""表是否已声明"（所有方言一致）
//  - 值的编码/解码（JSON 序列化、布尔表示、大整数）方言各异 → 由驱动注入 ValueCodec
// 这样两个驱动共享同一份表结构真相，不会随实现漂移。

import type { TableSchema } from '@kernel/contracts/storage.contract.js';

/** 存储层统一错误：方言细节（SqliteError / PostgresError）不得泄漏给上层。 */
export class StorageError extends Error {
  constructor(
    public readonly code: 'E_CONFLICT' | 'E_STORAGE',
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = code;
  }
}

export interface TableSchemaEntry {
  /** 应用侧字段 → 物理列名（未列出的字段按原名使用） */
  columns: Record<string, string>;
  /** 应用侧的 JSON 列名 */
  jsonColumns: string[];
}

/**
 * 内置表的结构声明。
 * JSON 列**必须显式声明**——禁止任何"看起来像 JSON 就解析"的启发式（会静默损坏正文文本）。
 */
export const TABLE_SCHEMAS: Record<string, TableSchemaEntry> = {
  entries: {
    columns: {
      tenantId: 'tenant_id',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      deletedAt: 'deleted_at',
    },
    jsonColumns: ['data'],
  },
  content_types: {
    columns: { tenantId: 'tenant_id', createdAt: 'created_at', updatedAt: 'updated_at' },
    jsonColumns: ['schema'],
  },
};

/** 值编解码：方言差异（JSON / 布尔 / 大整数）在驱动层吸收 */
export interface ValueCodec {
  /** 应用值 → DB 值 */
  encode(value: unknown, isJsonColumn: boolean): unknown;
  /** DB 值 → 应用值 */
  decode(value: unknown, isJsonColumn: boolean): unknown;
}

export interface SchemaRegistry {
  /** 模块私有表登记（未登记的表禁止读写——保留"防拼错表名"防护） */
  registerTable(name: string, schema: TableSchema): void;
  schemaOf(table: string): TableSchemaEntry;
}

export function createSchemaRegistry(): SchemaRegistry {
  const declared = new Map<string, TableSchemaEntry>(
    Object.entries(TABLE_SCHEMAS).map(([k, v]) => [
      k,
      { columns: { ...v.columns }, jsonColumns: [...v.jsonColumns] },
    ])
  );

  return {
    registerTable(name, schema): void {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new StorageError('E_STORAGE', `[storage] 非法表名: ${name}`);
      }
      declared.set(name, {
        columns: schema.columns ?? {},
        jsonColumns: schema.jsonColumns ?? [],
      });
    },

    schemaOf(table): TableSchemaEntry {
      const s = declared.get(table);
      if (!s) throw new StorageError('E_STORAGE', `[storage] 未声明的表结构: ${table}`);
      return s;
    },
  };
}

/** 应用行 → DB 行（列名下划线化 + 值编码；`undefined` 键跳过） */
export function toPhysicalRow(
  reg: SchemaRegistry,
  table: string,
  data: Record<string, unknown>,
  codec: ValueCodec
): Record<string, unknown> {
  const schema = reg.schemaOf(table);
  const jsonSet = new Set(schema.jsonColumns);
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    row[schema.columns[k] ?? k] = codec.encode(v, jsonSet.has(k));
  }
  return row;
}

/** DB 行 → 应用行（列名 camelCase 化 + 值解码） */
export function toLogicalRow(
  reg: SchemaRegistry,
  table: string,
  row: Record<string, unknown>,
  codec: ValueCodec
): Record<string, unknown> {
  const schema = reg.schemaOf(table);
  const reverse: Record<string, string> = {};
  for (const [camel, phys] of Object.entries(schema.columns)) reverse[phys] = camel;
  const jsonPhys = new Set(schema.jsonColumns.map((c) => schema.columns[c] ?? c));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[reverse[k] ?? k] = codec.decode(v, jsonPhys.has(k));
  }
  return out;
}

/** SQL 标识符白名单（防注入：仅字母数字下划线） */
export function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new StorageError('E_STORAGE', `[storage] 非法标识符: ${name}`);
  }
  return `"${name}"`;
}
