// modules/storage/drivers/sqlite.driver.ts
// 策略实现：SQLite 存储驱动。
// 只依赖内核契约（StorageDriver/StorageTx），不 import 其他模块。
// 必须遵守 storage.contract.ts 头部的"事务语义"（含可重入）。

import Database from 'better-sqlite3';
import type {
  QuerySpec,
  StorageDriver,
  StorageTx,
} from '@kernel/contracts/storage.contract.js';

interface SqliteConfig {
  /** 文件路径，或 ':memory:' */
  file: string;
}

/** 存储层统一错误：方言细节（如 SqliteError）不得泄漏给上层。 */
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

/** 表结构声明：列名映射 + 每列的解析类型。
 *  JSON 列必须显式声明——禁止任何"看起来像 JSON 就解析"的启发式（会静默损坏正文文本）。 */
const TABLE_SCHEMAS: Record<string, { columns: Record<string, string>; jsonColumns: string[] }> = {
  entries: {
    columns: { tenantId: 'tenant_id', createdAt: 'created_at', updatedAt: 'updated_at', deletedAt: 'deleted_at' },
    jsonColumns: ['data'],
  },
  content_types: {
    columns: { tenantId: 'tenant_id', createdAt: 'created_at', updatedAt: 'updated_at' },
    jsonColumns: ['schema'],
  },
};

function schemaOf(table: string) {
  const s = TABLE_SCHEMAS[table];
  if (!s) throw new StorageError('E_STORAGE', `[storage] 未声明的表结构: ${table}`);
  return s;
}

/** 把 camelCase 行对象转为 DB 行（列名下划线化；JSON 列序列化） */
function toRow(table: string, data: Record<string, unknown>): Record<string, unknown> {
  const { columns, jsonColumns } = schemaOf(table);
  const jsonSet = new Set(jsonColumns);
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    const phys = columns[k] ?? k;
    row[phys] = jsonSet.has(k) && typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
  }
  return row;
}

/** 把 DB 行还原为应用对象（下划线 → camelCase；仅声明过的 JSON 列做解析） */
function fromRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const { columns, jsonColumns } = schemaOf(table);
  const reverse: Record<string, string> = {};
  for (const [camel, phys] of Object.entries(columns)) reverse[phys] = camel;
  const jsonPhys = new Set(jsonColumns.map((c) => columns[c] ?? c));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (jsonPhys.has(k) && typeof v === 'string') {
      out[reverse[k] ?? k] = JSON.parse(v); // 声明过的 JSON 列解析失败=数据损坏，必须炸出来而非静默
      continue;
    }
    out[reverse[k] ?? k] = v;
  }
  return out;
}

/** 把 SqliteError 收敛为 StorageError（防方言错误码泄漏） */
function wrapError(table: string, e: unknown): unknown {
  const err = e as { code?: string; message?: string };
  if (err?.code?.startsWith('SQLITE_CONSTRAINT')) {
    return new StorageError('E_CONFLICT', `[storage] 违反约束 (${table}): ${err.message}`, {
      driverCode: err.code,
    });
  }
  return e; // 非约束类错误原样上抛（保留原始栈），由调用方决定
}

export function createSqliteDriver(config: SqliteConfig): StorageDriver {
  const db = new Database(config.file);
  const isMemory = config.file === ':memory:';
  if (!isMemory) db.pragma('journal_mode = WAL'); // WAL 对内存库无效，跳过（避免误导性配置）
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  let txDepth = 0; // 事务深度：0=无事务；嵌套用 SAVEPOINT（见契约"事务语义"）

  // 并发互斥：单连接上重叠的 transaction() 调用会交错 BEGIN/SAVEPOINT/COMMIT，
  // 相互污染（实测：Promise.all 两个事务 → "no such savepoint"）。
  // 外层调用排队串行；嵌套调用（txDepth>0）在当前事务流内直接放行，否则死锁。
  let txTail: Promise<unknown> = Promise.resolve();

  const makeTx = (): StorageTx => ({
    async find<T>(spec: QuerySpec): Promise<T[]> {
      const { sql, params } = buildSelect(spec);
      try {
        const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
        return rows.map((r) => fromRow(spec.table, r) as T);
      } catch (e) {
        throw wrapError(spec.table, e);
      }
    },

    async findOne<T>(spec: QuerySpec): Promise<T | null> {
      const { sql, params } = buildSelect({ ...spec, limit: 1 });
      try {
        const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
        return row ? (fromRow(spec.table, row) as T) : null;
      } catch (e) {
        throw wrapError(spec.table, e);
      }
    },

    async count(spec: QuerySpec): Promise<number> {
      const { where, params } = buildWhere(spec);
      try {
        const row = db
          .prepare(`SELECT COUNT(*) AS n FROM ${ident(spec.table)}${where}`)
          .get(...params) as { n: number };
        return row.n;
      } catch (e) {
        throw wrapError(spec.table, e);
      }
    },

    async insert<T>(table: string, data: T): Promise<T> {
      const row = toRow(table, data as Record<string, unknown>);
      const cols = Object.keys(row);
      const placeholders = cols.map(() => '?').join(', ');
      const sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (${placeholders})`;
      try {
        db.prepare(sql).run(...cols.map((c) => row[c]));
      } catch (e) {
        throw wrapError(table, e);
      }
      return data;
    },

    async update<T>(table: string, id: string, patch: Partial<T>): Promise<T> {
      const row = toRow(table, patch as Record<string, unknown>);
      const cols = Object.keys(row);
      try {
        if (cols.length > 0) {
          const sets = cols.map((c) => `${ident(c)} = ?`).join(', ');
          db.prepare(`UPDATE ${ident(table)} SET ${sets} WHERE id = ?`).run(
            ...cols.map((c) => row[c]),
            id
          );
        }
        const cur = db.prepare(`SELECT * FROM ${ident(table)} WHERE id = ?`).get(id) as
          | Record<string, unknown>
          | undefined;
        if (!cur) {
          throw new StorageError('E_CONFLICT', `[storage] 更新目标不存在: ${table}/${id}`);
        }
        return fromRow(table, cur) as T;
      } catch (e) {
        if (e instanceof StorageError) throw e;
        throw wrapError(table, e);
      }
    },

    async delete(table: string, id: string): Promise<void> {
      try {
        db.prepare(`DELETE FROM ${ident(table)} WHERE id = ?`).run(id);
      } catch (e) {
        throw wrapError(table, e);
      }
    },
  });

  return {
    dialect: 'sqlite' as const,
    async migrate(): Promise<void> {
      db.exec(DDL);
    },
    async transaction<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T> {
      const runTx = async (): Promise<T> => {
        txDepth += 1;
        const sp = `sp_${txDepth}`;
        const isOutermost = txDepth === 1;
        if (isOutermost) {
          db.exec('BEGIN'); // DEFERRED：WAL 下纯读不阻塞其他连接写
        } else {
          db.exec(`SAVEPOINT ${sp}`);
        }
        try {
          const result = await fn(makeTx());
          if (isOutermost) {
            db.exec('COMMIT');
          } else {
            db.exec(`RELEASE ${sp}`);
          }
          return result;
        } catch (e) {
          if (isOutermost) {
            try { db.exec('ROLLBACK'); } catch { /* 连接已异常时回滚本身可能失败，保原始错误 */ }
          } else {
            db.exec(`ROLLBACK TO ${sp}`);
            db.exec(`RELEASE ${sp}`);
            // 注意：嵌套回滚只回滚到保存点，外层事务仍活着；
            // 外层是否整体失败由外层 fn 自己的 try/catch 决定（契约语义 2/3）。
          }
          throw e;
        } finally {
          txDepth -= 1;
        }
      };

      if (txDepth > 0) return runTx(); // 嵌套：已在当前事务流内（SAVEPOINT 语义）
      const run = txTail.then(runTx);
      txTail = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
    async close(): Promise<void> {
      db.close();
    },
  };
}

/** SQL 标识符白名单（防注入：仅允许字母数字下划线） */
function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new StorageError('E_STORAGE', `[storage] 非法标识符: ${name}`);
  }
  return `"${name}"`;
}

/** 编译 where 子句 */
function buildWhere(spec: QuerySpec): { where: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const { columns } = schemaOf(spec.table);
  for (const [k, v] of Object.entries(spec.where ?? {})) {
    where.push(`${ident(columns[k] ?? k)} = ?`);
    params.push(v);
  }
  return { where: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

/** 把方言无关 QuerySpec 编成 SQL（仅 sqlite 驱动内部使用） */
function buildSelect(spec: QuerySpec): { sql: string; params: unknown[] } {
  const { where, params } = buildWhere(spec);
  let sql = `SELECT * FROM ${ident(spec.table)}${where}`;
  if (spec.orderBy?.length) {
    const { columns } = schemaOf(spec.table);
    const parts = spec.orderBy.map(
      (o) => `${ident(columns[o.field] ?? o.field)} ${o.dir === 'desc' ? 'DESC' : 'ASC'}`
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
