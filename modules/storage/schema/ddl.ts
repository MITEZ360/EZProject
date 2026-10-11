// modules/storage/schema/ddl.ts
// 模块私有表的 **DDL 生成**（方言无关）——物理类型名由驱动经 physicalType 注入。
//
// 存在的理由：模块手写 DDL，就必须知道物理类型与方言语法，而这正是
// "只在某个方言上炸"的缺陷来源（实测：5 张私有表的 INTEGER 列在 PG 上溢出 32 位）。
// 本文件把"声明"翻译成"语句"：列名走 ident 白名单，默认值只收字面量，
// 全程幂等（IF NOT EXISTS），方言差异只剩"物理类型名"这一个注入点。

import type { PortableColumnType, TableDef } from '@kernel/contracts/storage.contract.js';
import { StorageError, ident } from './tables.js';

/** 逻辑类型 → 物理类型名（由驱动按自身方言提供） */
export type PhysicalTypeOf = (type: PortableColumnType) => string;

/**
 * 字面量默认值。
 * 只接受数字与字符串——**拒绝 SQL 片段**：默认值来自模块声明，
 * 若允许任意片段，方言语法与注入风险会立刻从这个口子重新流入。
 */
function literal(v: number | string): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new StorageError('E_STORAGE', `[storage] 非法默认值（须为有限数字）: ${v}`);
    }
    return String(v);
  }
  return `'${v.replace(/'/g, "''")}'`;
}

/** 索引列：前缀 `-` 表示降序（如 `-occurred_at`） */
function indexColumn(raw: string): string {
  return raw.startsWith('-') ? `${ident(raw.slice(1))} DESC` : ident(raw);
}

/** 生成建表语句：第 1 条为 CREATE TABLE，其后为 CREATE INDEX。全部幂等 */
export function buildCreateTable(def: TableDef, physicalType: PhysicalTypeOf): string[] {
  if (def.columns.length === 0) {
    throw new StorageError('E_STORAGE', `[storage] 表 ${def.table} 未声明任何列`);
  }

  const seen = new Set<string>();
  for (const c of def.columns) {
    ident(c.name); // 校验列名合法（白名单，防注入）
    if (seen.has(c.name)) {
      throw new StorageError('E_STORAGE', `[storage] 表 ${def.table} 列名重复: ${c.name}`);
    }
    seen.add(c.name);
  }

  const cols = def.columns.map((c) => {
    const parts = [ident(c.name), physicalType(c.type)];
    if (c.primaryKey || c.notNull) parts.push('NOT NULL');
    if (c.default !== undefined) parts.push(`DEFAULT ${literal(c.default)}`);
    return parts.join(' ');
  });

  // 主键统一走表级声明（单列与复合同一条路径）
  const pk = def.columns.filter((c) => c.primaryKey).map((c) => c.name);
  if (pk.length > 0) cols.push(`PRIMARY KEY (${pk.map(ident).join(', ')})`);

  const stmts = [
    `CREATE TABLE IF NOT EXISTS ${ident(def.table)} (\n  ${cols.join(',\n  ')}\n);`,
  ];

  for (const idx of def.indexes ?? []) {
    if (idx.columns.length === 0) {
      throw new StorageError('E_STORAGE', `[storage] 索引 ${idx.name} 未声明列`);
    }
    stmts.push(
      `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${ident(idx.name)}` +
        ` ON ${ident(def.table)} (${idx.columns.map(indexColumn).join(', ')});`
    );
  }
  return stmts;
}
