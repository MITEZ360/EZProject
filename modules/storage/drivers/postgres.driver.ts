// modules/storage/drivers/postgres.driver.ts
// 策略实现：PostgreSQL 存储驱动（postgres.js——纯 JS 协议实现，**无原生模块**，
// 故与 SQLite 不同，它在 Bun 运行时下也能加载）。
//
// 必须遵守 storage.contract.ts 头部的"事务语义"（含可重入）。
//
// 与 SQLite 的关键差异（均由探针实测确认，见 dev-log）：
//  1. **JSON 查询**：PG 的 `->>` 一律返回 text，不 cast 会按**字典序**比较——
//     实测「price >= 10」会把 2/3/9 也命中。故必须按过滤器操作数推断 cast。
//     SQLite 的 json_extract 保留类型，无此问题 → 差异在驱动层吸收。
//  2. **事务重入**：PG 是连接池模型，无法像 SQLite 那样用全局深度计数；
//     用 AsyncLocalStorage 跟踪"当前事务"，嵌套时走 SAVEPOINT。
//  3. **并发**：PG 支持真并发（每个事务独立连接），不需要 SQLite 那套排队互斥。
//  4. **错误码**：23505（唯一冲突）→ E_CONFLICT。

import postgres from 'postgres';
import { AsyncLocalStorage } from 'node:async_hooks';
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

export interface PostgresConfig {
  /** 连接串，如 postgres://user:pass@host:5432/db */
  url: string;
  /** 连接池上限，默认 10 */
  max?: number;
}

export type PgConn = postgres.Sql<Record<string, never>>;
export type PgTx = postgres.TransactionSql<Record<string, never>>;
type Runner = PgConn | PgTx;

/**
 * 逻辑结构 → PG 物理表。
 * 物理类型遵循 6.5 跨方言约定：时间→bigint(epoch ms)。
 * JSON 列这里用 **text** 而非 jsonb——与 SQLite 侧保持同一逻辑类型，
 * 使模块私有表（DDL 由各模块自己写、跨方言通用）行为一致；
 * 查询时统一 `(col::jsonb->>...)` 等价于 jsonb 列的原生查询。
 */
const DDL = `
CREATE TABLE IF NOT EXISTS entries (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL,
  type        text NOT NULL,
  slug        text,
  locale      text NOT NULL,
  status      text NOT NULL,
  data        text NOT NULL,
  created_at  bigint NOT NULL,
  updated_at  bigint NOT NULL,
  deleted_at  bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_entries_active_slug
  ON entries (tenant_id, slug, deleted_at);
CREATE INDEX IF NOT EXISTS ix_entries_type ON entries (tenant_id, type);

CREATE TABLE IF NOT EXISTS content_types (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL,
  slug       text NOT NULL,
  schema     text NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
`;

/**
 * PG 的值编解码。
 * - JSON 列与 SQLite 一致：写入 stringify（TEXT 与 jsonb 列都能接收 JSON 文本）
 * - 布尔按契约 6.5 落 0/1（模块 DDL 用 INTEGER 存布尔，与 SQLite 同一约定）
 * - bigint 的连接级解析在连接配置里处理（见 types.bigint）
 */
const pgCodec: ValueCodec = {
  // 布尔**原样传递**：PG 有原生 BOOLEAN，契约 6.5 的约定就是该列落 BOOLEAN。
  // （SQLite 无 boolean 类型，那边仍转 0/1——方言差异在各自 codec 里吸收，
  //   这正是 ValueCodec 存在的意义。）
  encode: (v, isJson) => (isJson ? JSON.stringify(v) : v),
  decode: (v, isJson) => {
    // JSON 列：TEXT 存储时需解析（postgres.js 对 jsonb 列会自动解析，此处兜底）
    if (isJson && typeof v === 'string') return JSON.parse(v);
    return v;
  },
};

/** 把 PostgresError 收敛为 StorageError（防方言错误码泄漏） */
function wrapError(table: string, e: unknown): unknown {
  const err = e as { code?: string; message?: string };
  if (err?.code === '23505') {
    return new StorageError('E_CONFLICT', `[storage] 违反唯一约束 (${table}): ${err.message}`, {
      driverCode: err.code,
    });
  }
  if (err?.code === '23503') {
    return new StorageError('E_CONFLICT', `[storage] 违反外键约束 (${table}): ${err.message}`, {
      driverCode: err.code,
    });
  }
  return e; // 其他错误原样上抛（保留原始栈）
}

export function createPostgresDriver(config: PostgresConfig): StorageDriver {
  const registry = createSchemaRegistry();

  const sql = postgres(config.url, {
    max: config.max ?? 10,
    onnotice: () => {}, // 静默 NOTICE（如 IF NOT EXISTS 的提示）
    types: {
      // bigint 默认读成 string（防大整数精度丢失）——epoch 毫秒远小于 2^53，安全转 Number
      bigint: {
        to: 20,
        from: [20],
        serialize: (x: number | bigint) => String(x),
        parse: (x: string) => Number(x),
      },
    },
  }) as unknown as PgConn;

  // 当前事务上下文：PG 是连接池模型（每个事务独占一条连接），
  // 无法用 SQLite 那套全局深度计数，改用 AsyncLocalStorage 跟踪调用链上的当前事务。
  const txContext = new AsyncLocalStorage<PgTx>();

  const run = async <T>(runner: Runner, text: string, params: unknown[] = []): Promise<T[]> =>
    (await runner.unsafe(text, params as never)) as T[];

  /**
   * JSON 参数的包装器。
   * **必须用 postgres.js 的 sql.json() 标记**：直接传 JSON 字符串，postgres.js 会
   * 把它再序列化一次（'["hot"]' 变成 jsonb 字符串值而非数组），实测 `@>` 恒为 false。
   */
  const jsonParam = (v: unknown): unknown => sql.json(v as never);

  const makeTx = (runner: Runner): StorageTx => ({
    async find<T>(spec: QuerySpec): Promise<T[]> {
      const { sql: text, params } = buildSelect(spec, registry, jsonParam);
      try {
        const rows = await run<Record<string, unknown>>(runner, text, params);
        return rows.map((r) => toLogicalRow(registry, spec.table, r, pgCodec) as T);
      } catch (e) {
        throw wrapError(spec.table, e);
      }
    },

    async findOne<T>(spec: QuerySpec): Promise<T | null> {
      const { sql: text, params } = buildSelect({ ...spec, limit: 1 }, registry, jsonParam);
      try {
        const rows = await run<Record<string, unknown>>(runner, text, params);
        return rows[0] ? (toLogicalRow(registry, spec.table, rows[0], pgCodec) as T) : null;
      } catch (e) {
        throw wrapError(spec.table, e);
      }
    },

    async count(spec: QuerySpec): Promise<number> {
      const { where, params } = buildConditions(spec, registry, jsonParam);
      try {
        const rows = await run<{ n: number }>(
          runner,
          `SELECT COUNT(*)::int AS n FROM ${ident(spec.table)}${where}`,
          params
        );
        return rows[0]?.n ?? 0;
      } catch (e) {
        throw wrapError(spec.table, e);
      }
    },

    async exec(text: string, params: unknown[] = []): Promise<void> {
      // 无参数 → simple protocol（支持多条 DDL）；有参数 → 绑参执行单条
      try {
        await run(runner, text, params);
      } catch (e) {
        throw wrapError('unknown', e);
      }
    },

    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      return run<T>(runner, text, params);
    },

    async insert<T>(table: string, data: T): Promise<T> {
      const schema = registry.schemaOf(table);
      const row = toPhysicalRow(registry, table, data as Record<string, unknown>, pgCodec);
      const cols = Object.keys(row);
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const text = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (${placeholders.join(', ')})`;
      try {
        await run(
          runner,
          text,
          cols.map((c) => row[c])
        );
      } catch (e) {
        throw wrapError(table, e);
      }
      void schema;
      return data;
    },

    async update<T>(table: string, id: string, patch: Partial<T>): Promise<T> {
      const row = toPhysicalRow(registry, table, patch as Record<string, unknown>, pgCodec);
      const cols = Object.keys(row);
      try {
        if (cols.length > 0) {
          const sets = cols.map((c, i) => `${ident(c)} = $${i + 1}`).join(', ');
          await run(
            runner,
            `UPDATE ${ident(table)} SET ${sets} WHERE id = $${cols.length + 1}`,
            [...cols.map((c) => row[c]), id]
          );
        }
        const rows = await run<Record<string, unknown>>(
          runner,
          `SELECT * FROM ${ident(table)} WHERE id = $1`,
          [id]
        );
        if (!rows[0]) {
          throw new StorageError('E_CONFLICT', `[storage] 更新目标不存在: ${table}/${id}`);
        }
        return toLogicalRow(registry, table, rows[0], pgCodec) as T;
      } catch (e) {
        if (e instanceof StorageError) throw e;
        throw wrapError(table, e);
      }
    },

    async delete(table: string, id: string): Promise<void> {
      try {
        await run(runner, `DELETE FROM ${ident(table)} WHERE id = $1`, [id]);
      } catch (e) {
        throw wrapError(table, e);
      }
    },
  });

  /**
   * 声明式建表：DDL 由 buildCreateTable 按「逻辑类型 → PG 物理类型」生成。
   * 建表与索引在同一事务内（PG 的 DDL 支持事务，失败不留半成品）。
   */
  const applyCreateTable = async (def: TableDef): Promise<void> => {
    if (def.schema) registry.registerTable(def.table, def.schema);
    const stmts = buildCreateTable(def, (t) => column(t, 'col', 'postgres').physical);
    await sql.begin(async (tx) => {
      for (const stmt of stmts) await run(tx as PgTx, stmt);
    });
  };

  return {
    dialect: 'postgres',

    async migrate(): Promise<void> {
      await run(sql, DDL);
    },

    registerTable(name: string, schema: TableSchema): void {
      registry.registerTable(name, schema);
    },

    createTable: applyCreateTable,

    async transaction<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T> {
      const outer = txContext.getStore();
      if (outer) {
        // 嵌套：在当前事务上加 SAVEPOINT（内层回滚不影响外层，契约语义 2/3）
        const nested = await outer.savepoint(async (sp) => {
          const tx = makeTx(sp);
          return txContext.run(sp, () => fn(tx));
        });
        return nested as T;
      }
      const result = await sql.begin(async (tx) => {
        const current = makeTx(tx);
        return txContext.run(tx, () => fn(current));
      });
      return result as T;
    },

    async close(): Promise<void> {
      await sql.end();
    },
  };
}

/**
 * 编译 where + filters（AND 组合）。
 * 顶层列走物理列；点路径走 `(col::jsonb->>'path')`。
 * **关键**：jsonb 的 `->>` 返回 text，数字/布尔比较必须 cast，
 * 否则按字典序比较（实测会把 2/3/9 也算作 >= 10）。
 */
function buildConditions(
  spec: QuerySpec,
  registry: ReturnType<typeof createSchemaRegistry>,
  jsonParam: (v: unknown) => unknown
): { where: string; params: unknown[] } {
  const { columns, jsonColumns } = registry.schemaOf(spec.table);
  const jsonPhys = new Set(jsonColumns.map((c) => columns[c] ?? c));
  const conds: string[] = [];
  const params: unknown[] = [];

  const ph = (v: unknown, asJson = false): string => {
    params.push(asJson ? jsonParam(v) : v);
    return `$${params.length}`;
  };

  /** 返回「表达式」与「该字段是否为 JSON 路径」（决定要不要 cast 比较） */
  const exprOf = (field: string): { expr: string; isJsonPath: boolean } => {
    const head = field.split('.')[0]?.replace(/["']/g, '') ?? '';
    if (!field.includes('.')) {
      const physical = columns[head] ?? head;
      return { expr: `${ident(spec.table)}.${ident(physical)}`, isJsonPath: false };
    }
    const path = field
      .split('.')
      .slice(1)
      .map((p) => p.replace(/["']/g, ''))
      .join('.');
    void jsonPhys;
    return { expr: `(${ident(head)}::jsonb->>'${path}')`, isJsonPath: true };
  };

  /** 比较用表达式：JSON 路径按操作数值类型 cast（数字 → numeric，其余保持 text） */
  const cmpOf = (field: string, value: unknown): { expr: string; value: unknown } => {
    const { expr, isJsonPath } = exprOf(field);
    if (!isJsonPath) return { expr, value };
    if (typeof value === 'number') return { expr: `(${expr})::numeric`, value };
    if (typeof value === 'boolean') return { expr: `(${expr})::boolean`, value };
    return { expr, value };
  };

  for (const [k, v] of Object.entries(spec.where ?? {})) {
    const { expr, isJsonPath } = exprOf(k);
    // where 等值：JSON 路径同样按值类型 cast（否则数字等值也会按文本比对）
    if (isJsonPath && typeof v === 'number') conds.push(`(${expr})::numeric = ${ph(v)}`);
    else conds.push(`${expr} = ${ph(v)}`);
  }

  for (const f of spec.filters ?? []) {
    switch (f.op) {
      case 'eq': {
        const c = cmpOf(f.field, f.value);
        conds.push(`${c.expr} = ${ph(c.value)}`);
        break;
      }
      case 'ne': {
        const c = cmpOf(f.field, f.value);
        conds.push(`${c.expr} != ${ph(c.value)}`);
        break;
      }
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const sym = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[f.op];
        const c = cmpOf(f.field, f.value);
        conds.push(`${c.expr} ${sym} ${ph(c.value)}`);
        break;
      }
      case 'in': {
        if (!Array.isArray(f.value)) {
          throw new StorageError('E_STORAGE', 'in 条件的 value 必须为数组');
        }
        const c = cmpOf(f.field, f.value[0]);
        conds.push(`${c.expr} IN (${f.value.map((v) => ph(v)).join(', ')})`);
        break;
      }
      case 'contains': {
        if (Array.isArray(f.value)) {
          // 数组包含：jsonb @> （需把目标数组也作为 jsonb 传入）
          const head = f.field.split('.')[0]?.replace(/["']/g, '') ?? '';
          const path = f.field
            .split('.')
            .slice(1)
            .map((p) => p.replace(/["']/g, ''))
            .join('.');
          const lhs = path ? `(${ident(head)}::jsonb->'${path}')` : `${ident(head)}::jsonb`;
          conds.push(`${lhs} @> ${ph(f.value, true)}`);
        } else {
          const { expr } = exprOf(f.field);
          conds.push(`${expr} LIKE ${ph(`%${String(f.value)}%`)}`);
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
  registry: ReturnType<typeof createSchemaRegistry>,
  jsonParam: (v: unknown) => unknown
): { sql: string; params: unknown[] } {
  const { where, params } = buildConditions(spec, registry, jsonParam);
  let text = `SELECT * FROM ${ident(spec.table)}${where}`;
  if (spec.orderBy?.length) {
    const { columns } = registry.schemaOf(spec.table);
    const parts = spec.orderBy.map(
      (o) => `${ident(columns[o.field] ?? o.field)} ${o.dir === 'desc' ? 'DESC' : 'ASC'}`
    );
    text += ` ORDER BY ${parts.join(', ')}`;
  }
  if (typeof spec.limit === 'number') {
    params.push(spec.limit);
    text += ` LIMIT $${params.length}`;
  }
  if (typeof spec.offset === 'number') {
    params.push(spec.offset);
    text += ` OFFSET $${params.length}`;
  }
  return { sql: text, params };
}
