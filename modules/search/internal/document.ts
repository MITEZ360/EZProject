// modules/search/internal/document.ts
// 搜索的**方言无关共享层**：索引什么内容、哪些列可被过滤、payload 怎么读回。
// 凡"与引擎无关"的部分都收敛到本文件，各方言策略只管自己的 DDL 与查询语法。
//
// 为什么必须共用：索引内容或过滤语义一旦不同，同一查询在两方言下会得到不同结果，
// 契约测试就无法参数化跑两方言。

import { tokenize } from './tokenize.js';

/** 递归深度上限（component 嵌套限 3，但 json 逃生舱字段可能更深） */
const MAX_DEPTH = 8;

/** 元数据字段不参与全文检索（它们在 payload 里保留，只是不进索引） */
export const SKIP_KEYS = new Set([
  'id', 'tenantId', 'type', 'slug', 'locale', 'status',
  'createdAt', 'updatedAt', 'deletedAt',
]);

/** filter 允许的列白名单（列名直接拼 SQL，必须白名单化；两方言表列名一致） */
export const FILTERABLE = new Set(['status', 'set_name', 'doc_id']);

/** 递归收集可检索文本：字符串入索引；数字/布尔不入（范围类查询应走 filter） */
function collectText(value: unknown, out: string[], depth = 0): void {
  if (depth > MAX_DEPTH) return;
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

/**
 * 文档 → 已切分的可检索文本（**索引侧的单一来源**，两方言共用）。
 * 返回值可直接作为 FTS5 的 body 列内容，或 PG `to_tsvector(cfg, $n)` 的输入。
 */
export function searchableText(document: Record<string, unknown>): string {
  const parts: string[] = [];
  collectText(document, parts);
  return tokenize(parts.join(' '));
}

/**
 * 读回 payload（写在索引行里的原始文档 JSON）。
 * 解析失败不抛错——索引是**派生数据**，坏一行不应让整个检索请求失败。
 */
export function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
