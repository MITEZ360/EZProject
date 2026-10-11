// modules/storage/drivers/sqlite.driver.ts
// 策略实现：SQLite 存储驱动。
// 只依赖内核契约（StorageDriver/StorageTx），不 import 其他模块。

import Database from 'better-sqlite3';
import type {
  Dialect,
  QuerySpec,
  StorageDriver,
  StorageTx,
} from '@kernel/contracts/storage.contract.js';

interface SqliteConfig {
  /** 文件路径，或 ':memory:' */
  file: string;
}

/** 建表 DDL：内容相关表的"方言无关逻辑结构"落地为 SQLite 物理表。
 *  物理类型遵循 6.5 约定：JSON→TEXT、时间→INTEGER(epoch ms)、bool→INTEGER。 */
const DDL = `
CREATE TABLE IF NOT EXISTS entries (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  type         TEXT NOT NULL,
  slug         TEXT,
  locale       TEXT NOT NULL,
  status       TEXT NOT NULL,
  data         TEXT NOT NULL,          -- JSON
  created_at   INTEGER NOT NULL,       -- epoch ms
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_entries_active_slug
  ON entries (tenant_id, slug, deleted_at);
CREATE INDEX IF NOT EXISTS ix_entries_type ON entries (tenant_id, type);

CREATE TABLE IF NOT EXISTS content_types (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  slug       TEXT NOT NULL,
  schema     TEXT NOT NULL,            -- JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/** 把"表名"映射到物理列名（方言无关 → 物理） */
const COLUMN_MAP: Record<string, string> = {
  tenantId: 'tenant_id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  deletedAt: 'deleted_at',
};

function toPhysical(col: string): string {
  return COLUMN_MAP[col] ?? col;
}

/** 把 camelCase 行对象转为 DB 行（列名下划线化；对象/数组序列化为 JSON） */
function toRow(data: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    const phys = toPhysical(k);
    row[phys] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
  }
  return row;
}

/** 把 DB 行还原为应用对象（下划线 → camelCase；JSON 文本尝试解析） */
function fromRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const reverse: Record<string, string> = {};
  for (const [camel, phys] of Object.entries(COLUMN_MAP)) reverse[phys] = camel;
  for (const [k, v] of Object.entries(row)) {
    const camel = reverse[k] ?? k;
    if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
      try {
        out[camel] = JSON.parse(v);
        continue;
      } catch {
        /* 不是 JSON，按原样 */
      }
    }
    out[camel] = v;
  }
  return out;
}

export function createSqliteDriver(config: SqliteConfig): StorageDriver {
  const db = new Database(config.file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  const makeTx = (): StorageTx => ({
    async find<T>(spec: QuerySpec): Promise<T[]> {
      const { sql, params } = buildSelect(spec);
      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
      return rows.map((r) => fromRow(r) as T);
    },

    async findOne<T>(spec: QuerySpec): Promise<T | null> {
      const { sql, params } = buildSelect({ ...spec, limit: 1 });
      const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
      return row ? (fromRow(row) as T) : null;
    },

    async insert<T>(table: string, data: T): Promise<T> {
      const row = toRow(data as Record<string, unknown>);
      const cols = Object.keys(row);
      const placeholders = cols.map(() => '?').join(', ');
      const sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (${placeholders})`;
      db.prepare(sql).run(...cols.map((c) => row[c]));
      return data;
    },

    async update<T>(table: string, id: string, patch: Partial<T>): Promise<T> {
      const row = toRow(patch as Record<string, unknown>);
      const cols = Object.keys(row);
      if (cols.length === 0) {
        const cur = db.prepare(`SELECT * FROM ${ident(table)} WHERE id = ?`).get(id);
        return fromRow(cur as Record<string, unknown>) as T;
      }
      const sets = cols.map((c) => `${ident(c)} = ?`).join(', ');
      const sql = `UPDATE ${ident(table)} SET ${sets} WHERE id = ?`;
      db.prepare(sql).run(...cols.map((c) => row[c]), id);
      const cur = db.prepare(`SELECT * FROM ${ident(table)} WHERE id = ?`).get(id);
      return fromRow(cur as Record<string, unknown>) as T;
    },

    async delete(table: string, id: string): Promise<void> {
      db.prepare(`DELETE FROM ${ident(table)} WHERE id = ?`).run(id);
    },
  });

  return {
    dialect: 'sqlite' as Dialect,
    async migrate(): Promise<void> {
      db.exec(DDL);
    },
    async transaction<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T> {
      // better-sqlite3 的事务是同步的；用扁平事务包住异步回调
      db.exec('BEGIN');
      try {
        const result = await fn(makeTx());
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async close(): Promise<void> {
      db.close();
    },
  };
}

/** SQL 标识符白名单（防注入：仅允许字母数字下划线） */
function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`[storage] 非法标识符: ${name}`);
  }
  return `"${name}"`;
}

/** 把方言无关 QuerySpec 编成 SQL（仅 sqlite 驱动内部使用） */
function buildSelect(spec: QuerySpec): { sql: string; params: unknown[] } {
  const table = ident(spec.table);
  const where: string[] = [];
  const params: unknown[] = [];

  for (const [k, v] of Object.entries(spec.where ?? {})) {
    where.push(`${ident(toPhysical(k))} = ?`);
    params.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
  }

  let sql = `SELECT * FROM ${table}`;
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;

  if (spec.orderBy?.length) {
    const parts = spec.orderBy.map(
      (o) => `${ident(toPhysical(o.field))} ${o.dir === 'desc' ? 'DESC' : 'ASC'}`
    );
    sql += ` ORDER BY ${parts.join(', ')}`;
  }
  if (typeof spec.limit === 'number') {
    sql += ' LIMIT ?';
    params.push(spec.limit);
  }
  if (typeof spec.offset === 'number') {
    sql += ' OFFSET ?';
    params.push(spec.offset);
  }
  return { sql, params };
}
