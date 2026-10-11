// modules/search/internal/postgres-fts.ts
// PostgreSQL 全文检索策略（tsvector / tsquery，零扩展依赖——均为 PG 内置）。
// 契约见 kernel/contracts/search.contract.ts。
//
// 表为**模块私有表**：读写一律经 StorageTx 的 exec/query（契约允许的原生通道），
// 因为 `@@` 与 ts_rank 无法用 QuerySpec 表达。
//
// 与 SQLite FTS5 策略的语义对齐（经探针实测，见 dev-log）：
//   FTS5  phrase `"世 界"`  ≡  tsquery `世 <-> 界`
//   相邻命中 ✅ / 不相邻不命中 ✅ / 逆序不命中 ✅
//
// 已知限制（PG 硬限制，不可配置）：
//   tsvector 的 token 位置上限 MAXSTRPOS = 16383。超长文档（>16383 个 token，
//   单字切分下约 1.6 万汉字）中，超出部分的位置被**截断**为 16383，会让跨越
//   截断边界的短语查询产生**假阳性**（实测：相隔 3600 个 token 的两字仍被判定相邻）。
//   仅影响超长文档尾部的多字短语查询，且是"多召回"而非"漏召回"。判定为可接受。

import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import type {
  SearchProvider,
  SearchQuery,
  SearchResult,
} from '@kernel/contracts/search.contract.js';
import { FILTERABLE, parsePayload, searchableText } from './document.js';
import { tokenizeList } from './tokenize.js';

const TABLE = 'search_index';

/** 文本检索配置：simple = 不做词干化/停用词，纯按 token 匹配（中文必须用它） */
const TS_CONFIG = 'simple';

/**
 * 查询文本 → tsquery 表达式（`<->` 要求 token **相邻**）。
 * 与 FTS5 的 phrase 语义一致；详见 sqlite-fts.ts 的 toMatchExpr。
 *
 * 无需转义：token 由 tokenizeList 保证只含汉字/字母/数字，不含 `& | ! ( ) : *`
 * 等 tsquery 元字符——否则用户输入会被当作查询语法（探针已确认单字符英文与纯数字合法）。
 */
export function toTsQuery(text: string): string {
  const tokens = tokenizeList(text);
  return tokens.length ? tokens.join(' <-> ') : '';
}

/** 建表 + GIN 索引（逐条执行：PG 的多语句与参数绑定不能混用） */
export const POSTGRES_SEARCH_DDL: string[] = [
  `
CREATE TABLE IF NOT EXISTS ${TABLE} (
  doc_id    text     NOT NULL,
  set_name  text     NOT NULL,
  tenant_id text     NOT NULL,
  status    text     NOT NULL,
  payload   text     NOT NULL,
  body      tsvector NOT NULL,
  PRIMARY KEY (doc_id, set_name)
);
`,
  // GIN 是 tsvector 的标准索引类型；没有它每次检索都要全表扫描
  `CREATE INDEX IF NOT EXISTS ${TABLE}_body_gin ON ${TABLE} USING gin (body);`,
  // 过滤条件（租户/集合/状态）走 B-tree，避免只靠 GIN
  `CREATE INDEX IF NOT EXISTS ${TABLE}_scope ON ${TABLE} (tenant_id, set_name, status);`,
];

interface HitRow {
  doc_id: string;
  payload: string;
  score: number;
}

/** 输出 payload 的单行 JSON（与 FTS5 侧写入的 payload 格式一致） */
const jsonParam = (v: unknown): string => JSON.stringify(v ?? {});

export function createPostgresSearch(driver: StorageDriver): SearchProvider {
  /**
   * 覆盖写：表有 (doc_id, set_name) 主键，直接 ON CONFLICT 真 upsert
   * （比 FTS5 侧的"先删后插"更干净——那边是虚拟表没有唯一约束）。
   *
   * body 由 `to_tsvector(cfg, $6)` 在库内生成：索引侧与查询侧共用同一套
   * 应用层切分（searchableText → tokenizeList），ts_config 两处一致。
   * $6 是切分后的纯文本（汉字/字母/数字 + 空格），作为函数 text 参数传递。
   */
  const upsert = async (
    setName: string,
    id: string,
    document: Record<string, unknown>
  ): Promise<void> => {
    await driver.transaction((tx) =>
      tx.exec(
        `INSERT INTO ${TABLE} (doc_id, set_name, tenant_id, status, payload, body)
         VALUES ($1, $2, $3, $4, $5, to_tsvector('${TS_CONFIG}', $6))
         ON CONFLICT (doc_id, set_name) DO UPDATE
         SET tenant_id = EXCLUDED.tenant_id,
             status    = EXCLUDED.status,
             payload   = EXCLUDED.payload,
             body      = EXCLUDED.body`,
        [
          id,
          setName,
          String(document['tenantId'] ?? ''),
          String(document['status'] ?? ''),
          jsonParam(document),
          searchableText(document),
        ]
      )
    );
  };

  /** 拼 WHERE：tsquery 匹配 + 租户隔离 + 集合/白名单过滤（PG 用 $n 占位符） */
  const buildWhere = (query: SearchQuery): { clause: string; params: unknown[] } | null => {
    const expr = toTsQuery(query.text);
    if (!expr) return null;

    // $1 固定为 tsquery 表达式：WHERE 与 ORDER BY(ts_rank) 两处复用同一占位符
    const where: string[] = [`body @@ to_tsquery('${TS_CONFIG}', $1)`];
    const params: unknown[] = [expr];

    const bind = (cond: (p: string) => string, value: unknown): void => {
      params.push(value);
      where.push(cond(`$${params.length}`));
    };

    bind((p) => `tenant_id = ${p}`, query.tenantId);
    if (query.index) bind((p) => `set_name = ${p}`, query.index);
    for (const [k, v] of Object.entries(query.filter ?? {})) {
      if (!FILTERABLE.has(k) || v === undefined || v === null) continue; // 白名单，防列名注入
      bind((p) => `${k} = ${p}`, String(v));
    }
    return { clause: where.join(' AND '), params };
  };

  return {
    engine: 'postgres-fts',

    async index(setName: string, id: string, document: Record<string, unknown>): Promise<void> {
      await upsert(setName, id, document);
    },

    async remove(setName: string, id: string): Promise<void> {
      await driver.transaction((tx) =>
        tx.exec(`DELETE FROM ${TABLE} WHERE doc_id = $1 AND set_name = $2`, [id, setName])
      );
    },

    async search<T = Record<string, unknown>>(query: SearchQuery): Promise<SearchResult<T>> {
      const built = buildWhere(query);
      if (!built) return { hits: [], total: 0 };
      const { clause, params } = built;
      const limitAt = params.length + 1;
      const offsetAt = params.length + 2;

      // 同事务取「结果 + 总数」，保证两者一致（与 content.find 同一纪律）
      return driver.transaction(async (tx) => {
        // ts_rank 越大越相关 → 直接按 DESC（与 FTS5 侧 bm25 取负后方向一致）。
        // 次级排序 doc_id：同分时顺序确定，避免契约测试与分页抖动。
        const rows = await tx.query<HitRow>(
          `SELECT doc_id, payload, ts_rank(body, to_tsquery('${TS_CONFIG}', $1)) AS score
           FROM ${TABLE}
           WHERE ${clause}
           ORDER BY score DESC, doc_id
           LIMIT $${limitAt} OFFSET $${offsetAt}`,
          [...params, query.limit ?? 20, query.offset ?? 0]
        );
        // count 必须 cast 成 int：PG 的 count 是 bigint，驱动会返回字符串
        const counted = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${TABLE} WHERE ${clause}`,
          params
        );
        return {
          hits: rows.map((r) => ({
            id: r.doc_id,
            score: Number(r.score),
            document: parsePayload(r.payload) as T,
          })),
          total: counted[0]?.n ?? 0,
        };
      });
    },
  };
}
