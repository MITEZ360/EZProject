// modules/search/internal/sqlite-fts.ts
// SQLite FTS5 全文检索策略（零新依赖——FTS5 是 SQLite 内置扩展）。
// 契约见 kernel/contracts/search.contract.ts。
//
// 表为**模块私有表**：读写一律经 StorageTx 的 exec/query（契约允许的原生通道），
// 因为 FTS5 的 MATCH 无法用 QuerySpec 表达。

import type { StorageDriver, StorageTx } from '@kernel/contracts/storage.contract.js';
import type {
  SearchProvider,
  SearchQuery,
  SearchResult,
} from '@kernel/contracts/search.contract.js';
import { toMatchExpr, tokenize } from './tokenize.js';

const TABLE = 'search_index';

export const SEARCH_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS ${TABLE} USING fts5(
  doc_id    UNINDEXED,
  set_name  UNINDEXED,
  tenant_id UNINDEXED,
  status    UNINDEXED,
  payload   UNINDEXED,
  body
);
`;

/** 元数据字段不参与全文检索（它们在 payload 里保留，只是不进索引） */
const SKIP_KEYS = new Set([
  'id', 'tenantId', 'type', 'slug', 'locale', 'status',
  'createdAt', 'updatedAt', 'deletedAt',
]);

/** filter 允许的列白名单（列名直接拼 SQL，必须白名单化） */
const FILTERABLE = new Set(['status', 'set_name', 'doc_id']);

interface HitRow {
  doc_id: string;
  payload: string;
  score: number;
}

/** 递归收集可检索文本：字符串入索引；数字/布尔不入（范围类查询应走 filter） */
function collectText(value: unknown, out: string[], depth = 0): void {
  if (depth > 8) return; // 防深递归（component 嵌套限 3，但 json 字段可能更深）
  if (typeof value === 'string') {
    if (value) out.push(value);
    return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    for (const v of value) collectText(v, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SKIP_KEYS.has(k)) continue;
      collectText(v, out, depth + 1);
    }
  }
}

const safeParse = (s: string): Record<string, unknown> => {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const DELETE_BY_DOC = `DELETE FROM ${TABLE} WHERE rowid IN (SELECT rowid FROM ${TABLE} WHERE doc_id = ? AND set_name = ?)`;

export function createSqliteSearch(driver: StorageDriver): SearchProvider {
  /** 覆盖写：FTS5 无唯一约束 → 先按 (doc_id, set_name) 删再插 */
  const upsert = async (
    tx: StorageTx,
    setName: string,
    id: string,
    document: Record<string, unknown>
  ): Promise<void> => {
    const parts: string[] = [];
    collectText(document, parts);
    await tx.exec(DELETE_BY_DOC, [id, setName]);
    await tx.exec(
      `INSERT INTO ${TABLE} (doc_id, set_name, tenant_id, status, payload, body) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        setName,
        String(document['tenantId'] ?? ''),
        String(document['status'] ?? ''),
        JSON.stringify(document),
        tokenize(parts.join(' ')),
      ]
    );
  };

  /** 拼 WHERE：MATCH 短语 + 租户隔离 + 集合/白名单过滤。返回子句与参数 */
  const buildWhere = (query: SearchQuery): { clause: string; params: unknown[] } | null => {
    const expr = toMatchExpr(query.text);
    if (!expr) return null;
    const clause: string[] = ['body MATCH ?', 'tenant_id = ?'];
    const params: unknown[] = [expr, query.tenantId];
    if (query.index) {
      clause.push('set_name = ?');
      params.push(query.index);
    }
    for (const [k, v] of Object.entries(query.filter ?? {})) {
      if (!FILTERABLE.has(k) || v === undefined || v === null) continue; // 白名单，防列名注入
      clause.push(`${k} = ?`);
      params.push(String(v));
    }
    return { clause: clause.join(' AND '), params };
  };

  return {
    engine: 'sqlite-fts5',

    async index(setName: string, id: string, document: Record<string, unknown>): Promise<void> {
      await driver.transaction((tx) => upsert(tx, setName, id, document));
    },

    async remove(setName: string, id: string): Promise<void> {
      await driver.transaction((tx) => tx.exec(DELETE_BY_DOC, [id, setName]));
    },

    async search<T = Record<string, unknown>>(query: SearchQuery): Promise<SearchResult<T>> {
      const built = buildWhere(query);
      if (!built) return { hits: [], total: 0 };
      const { clause, params } = built;

      // 同事务取「结果 + 总数」，保证两者一致（与 content.find 同一纪律）
      return driver.transaction(async (tx) => {
        const rows = await tx.query<HitRow>(
          `SELECT doc_id, payload, bm25(${TABLE}) AS score FROM ${TABLE}
           WHERE ${clause} ORDER BY bm25(${TABLE}) LIMIT ? OFFSET ?`,
          [...params, query.limit ?? 20, query.offset ?? 0]
        );
        const counted = await tx.query<{ n: number }>(
          `SELECT count(*) AS n FROM ${TABLE} WHERE ${clause}`,
          params
        );
        return {
          hits: rows.map((r) => ({
            id: r.doc_id,
            score: -r.score, // bm25 越小越相关 → 取负，使契约里"分数越大越相关"
            document: safeParse(r.payload) as T,
          })),
          total: counted[0]?.n ?? 0,
        };
      });
    },
  };
}
