// modules/storage/drivers/sqlite.driver.ts
// 策略实现：SQLite 存储驱动。
// 只依赖内核契约（StorageDriver/StorageTx），不 import 其他模块。
// 必须遵守 storage.contract.ts 头部的"事务语义"（含可重入）。

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  QuerySpec,
  StorageDriver,
  StorageTx,
  TableDef,
  TableSchema,
} from '@kernel/contracts/storage.contract.js';
import {
  StorageError,
  createSchemaRegistry,
  ident,
  toLogicalRow,
  toPhysicalRow,
  type ValueCodec,
} from '../schema/tables.js';
import { buildCreateTable } from '../schema/ddl.js';
import { column } from '../schema/columns.js';

export { StorageError };

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

/**
 * SQLite 的值编解码：
 *  - JSON 列一律 JSON.stringify（字符串值也加引号，保证读回 parse 恒成功）
 *  - 布尔按契约 6.5 落 INTEGER（SQLite 无原生 bool）
 */
const sqliteCodec: ValueCodec = {
  encode: (v, isJson) => {
    if (isJson) return JSON.stringify(v);
    return typeof v === 'boolean' ? (v ? 1 : 0) : v;
  },
  decode: (v, isJson) => {
    // 声明过的 JSON 列解析失败 = 数据损坏，必须炸出来而非静默
    if (isJson && typeof v === 'string') return JSON.parse(v);
    return v;
  },
};

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
  const registry = createSchemaRegistry();
  const isMemory = config.file === ':memory:';
  if (!isMemory) {
    // 父目录不存在时 better-sqlite3 抛的是英文原生错误
    // （"Cannot open database because the directory does not exist"）。
    // 对"解压即用"的定位来说，让使用者先手动 mkdir 不合理——驱动自己建。
    mkdirSync(dirname(config.file), { recursive: true });
  }
  const db = new Database(config.file);
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
      const { sql, params } = buildSelect(spec, registry);
      try {
        const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
        return rows.map((r) => toLogicalRow(registry, spec.table, r, sqliteCodec) as T);
      } catch (e) {
        throw wrapError(spec.table, e);
      }
    },

    async findOne<T>(spec: QuerySpec): Promise<T | null> {
      const { sql, params } = buildSelect({ ...spec, limit: 1 }, registry);
      try {
        const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
        return row ? (toLogicalRow(registry, spec.table, row, sqliteCodec) as T) : null;
      } catch (e) {
        throw wrapError(spec.table, e);
      }
    },

    async count(spec: QuerySpec): Promise<number> {
      const { where, params } = buildConditions(spec, registry);
      try {
        const row = db
          .prepare(`SELECT COUNT(*) AS n FROM ${ident(spec.table)}${where}`)
          .get(...params) as { n: number };
        return row.n;
      } catch (e) {
        throw wrapError(spec.table, e);
      }
    },

    async exec(sql: string, params: unknown[] = []): Promise<void> {
      // 无参数 → exec（支持多条 DDL）；有参数 → prepare/run（单条，绑定安全）
      if (params.length > 0) db.prepare(sql).run(...params);
      else db.exec(sql); // 调用方在事务内使用时随事务提交/回滚
    },

    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },

    async insert<T>(table: string, data: T): Promise<T> {
      const row = toPhysicalRow(registry, table, data as Record<string, unknown>, sqliteCodec);
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
      const row = toPhysicalRow(registry, table, patch as Record<string, unknown>, sqliteCodec);
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
        return toLogicalRow(registry, table, cur, sqliteCodec) as T;
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

  /**
   * 声明式建表：DDL 由 buildCreateTable 按「逻辑类型 → SQLite 物理类型」生成，
   * 模块不再手写物理类型（INTEGER/BIGINT/TEXT 这类知识收归存储层）。
   * better-sqlite3 的 exec 支持多语句一次执行；语句全部 IF NOT EXISTS，幂等。
   */
  const applyCreateTable = async (def: TableDef): Promise<void> => {
    if (def.schema) registry.registerTable(def.table, def.schema);
    db.exec(buildCreateTable(def, (t) => column(t, 'col', 'sqlite').physical).join('\n'));
  };

  return {
    dialect: 'sqlite' as const,
    async migrate(): Promise<void> {
      db.exec(DDL);
    },
    registerTable(name: string, schema: TableSchema): void {
      registry.registerTable(name, schema);
    },
    createTable: applyCreateTable,
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

/** 编译 where + filters（AND 组合）。顶层列走物理列；点路径走 json_extract。 */
function buildConditions(
  spec: QuerySpec,
  registry: ReturnType<typeof createSchemaRegistry>
): { where: string; params: unknown[] } {
  const { columns } = registry.schemaOf(spec.table);
  const conds: string[] = [];
  const params: unknown[] = [];

  const table = spec.table; // schemaOf(spec.table) 已确保是已声明的合法表名
  /** 'data.price' → json_extract("data", '$.price')；'status' → "entries"."status" */
  const exprOf = (field: string): string => {
    const col = field.split('.')[0]?.replace(/["']/g, '') ?? '';
    if (!field.includes('.')) return `"${table}".${ident(columns[col] ?? col)}`;
    const jsonPath = field
      .split('.')
      .slice(1)
      .map((p) => p.replace(/["']/g, ''))
      .join('.');
    return `json_extract(${ident(col)}, '$.${jsonPath}')`;
  };

  for (const [k, v] of Object.entries(spec.where ?? {})) {
    conds.push(`${exprOf(k)} = ?`);
    params.push(v);
  }
  for (const f of spec.filters ?? []) {
    const expr = exprOf(f.field);
    switch (f.op) {
      case 'eq': conds.push(`${expr} = ?`); params.push(f.value); break;
      case 'ne': conds.push(`${expr} != ?`); params.push(f.value); break;
      case 'gt': conds.push(`${expr} > ?`); params.push(f.value); break;
      case 'gte': conds.push(`${expr} >= ?`); params.push(f.value); break;
      case 'lt': conds.push(`${expr} < ?`); params.push(f.value); break;
      case 'lte': conds.push(`${expr} <= ?`); params.push(f.value); break;
      case 'in': {
        if (!Array.isArray(f.value)) throw new StorageError('E_STORAGE', 'in 条件的 value 必须为数组');
        conds.push(`${expr} IN (${f.value.map(() => '?').join(',')})`);
        params.push(...f.value);
        break;
      }
      case 'contains': {
        if (Array.isArray(f.value)) {
          // 数组包含：json_each 展开该 JSON 列
          const col = f.field.split('.')[0]?.replace(/["']/g, '') ?? '';
          const jsonPath = f.field
            .split('.')
            .slice(1)
            .map((p) => p.replace(/["']/g, ''))
            .join('.');
          const members = f.value.map(() => '?').join(',');
          conds.push(
            `EXISTS (SELECT 1 FROM json_each(${ident(col)}, '$.${jsonPath}') WHERE value IN (${members}))`
          );
          params.push(...f.value);
        } else {
          conds.push(`${expr} LIKE ?`);
          params.push(`%${String(f.value)}%`);
        }
        break;
      }
    }
  }
  return { where: conds.length ? ` WHERE ${conds.join(' AND ')}` : '', params };
}

/** 把方言无关 QuerySpec 编成 SQL（驱动内部使用） */
function buildSelect(
  spec: QuerySpec,
  registry: ReturnType<typeof createSchemaRegistry>
): { sql: string; params: unknown[] } {
  const { where, params } = buildConditions(spec, registry);
  let sql = `SELECT * FROM ${ident(spec.table)}${where}`;
  if (spec.orderBy?.length) {
    const { columns } = registry.schemaOf(spec.table);
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
