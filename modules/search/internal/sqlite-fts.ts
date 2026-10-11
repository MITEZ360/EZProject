// modules/search/internal/sqlite-fts.ts
// SQLite FTS5 全文检索策略（零新依赖——FTS5 是 SQLite 内置扩展）。
// 契约见 kernel/contracts/search.contract.ts。
//
// 表为**模块私有表**：读写一律经 StorageTx 的 exec/query（契约允许的原生通道），
// 因为 FTS5 的 MATCH 无法用 QuerySpec 表达。
//
// 方言相关的只有三处：DDL、MATCH 语法（`"a b"`）、排序函数（bm25）。
// 索引内容与 filter 白名单等方言无关部分见 document.ts。

import type { StorageDriver, StorageTx } from '@kernel/contracts/storage.contract.js';
import type {
  SearchProvider,
  SearchQuery,
  SearchResult,
} from '@kernel/contracts/search.contract.js';
import { FILTERABLE, parsePayload, searchableText } from './document.js';
import { tokenizeList } from './tokenize.js';

const TABLE = 'search_index';

/**
 * 查询文本 → FTS5 MATCH 表达式（**短语**：token 必须相邻）。
 * 用 phrase 而非 AND：中文搜「世界」若拆成 `"世" AND "界"` 会命中「世…界」这类
 * 不相邻文本，噪音过大；短语语义符合「搜什么就匹配什么」的直觉。
 *
 * PG 侧的对应实现见 postgres-fts.ts 的 toTsQuery（`世 <-> 界`），两者语义经探针
 * 实测对齐：相邻命中、不相邻不命中、逆序不命中。
 *
 * 无需转义：token 由 tokenizeList 保证只含汉字/字母/数字。
 */
export function toMatchExpr(text: string): string {
  const tokens = tokenizeList(text);
  return tokens.length ? `"${tokens.join(' ')}"` : '';
}

export const SQLITE_SEARCH_DDL: string[] = [
  `
CREATE VIRTUAL TABLE IF NOT EXISTS ${TABLE} USING fts5(
  doc_id    UNINDEXED,
  set_name  UNINDEXED,
  tenant_id UNINDEXED,
  status    UNINDEXED,
  payload   UNINDEXED,
  body
);
`,
];

interface HitRow {
  doc_id: string;
  payload: string;
  score: number;
}

const DELETE_BY_DOC = `DELETE FROM ${TABLE} WHERE rowid IN (SELECT rowid FROM ${TABLE} WHERE doc_id = ? AND set_name = ?)`;

export function createSqliteSearch(driver: StorageDriver): SearchProvider {
  /** 覆盖写：FTS5 无唯一约束 → 先按 (doc_id, set_name) 删再插 */
  const upsert = async (
    tx: StorageTx,
    setName: string,
    id: string,
    document: Record<string, unknown>
  ): Promise<void> => {
    await tx.exec(DELETE_BY_DOC, [id, setName]);
    await tx.exec(
      `INSERT INTO ${TABLE} (doc_id, set_name, tenant_id, status, payload, body) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        setName,
        String(document['tenantId'] ?? ''),
        String(document['status'] ?? ''),
        JSON.stringify(document),
        searchableText(document),
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
        // 次级排序 doc_id：同分时顺序确定，避免契约测试与分页抖动
        const rows = await tx.query<HitRow>(
          `SELECT doc_id, payload, bm25(${TABLE}) AS score FROM ${TABLE}
           WHERE ${clause} ORDER BY bm25(${TABLE}), doc_id LIMIT ? OFFSET ?`,
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
            document: parsePayload(r.payload) as T,
          })),
          total: counted[0]?.n ?? 0,
        };
      });
    },
  };
}
