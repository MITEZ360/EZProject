// modules/search/internal/tokenize.ts
// 全文检索的切分策略（纯函数，索引与查询共用同一套，否则对不上）。
// 本文件**只做切分**，不含任何查询语法——FTS5 的 `"a b"` 与 PG 的 `a <-> b`
// 由各自的策略文件拼装（见 sqlite-fts.ts / postgres-fts.ts）。
//
// 背景（实测结论，见 dev-log）：FTS5 默认的 unicode61 分词器对**中文基本不可用**——
// 中文没有空格，"整词"即整句，搜「世界」无法命中「你好世界」。
// 实测对比（同一语料）：
//   unicode61 原文   → 整词命中，2 字片段不命中，索引 720KB
//   单字切分         → 全部命中，索引 1088KB（+51%）  ← 采用
//   二元切分         → 全部命中，索引 1628KB（+126%）
//   trigram          → 2 字以下查询不命中（要求 ≥3 字符）
// 故采用**单字切分**：中文逐字成 token，英文/数字按词保留，标点作分隔。

/**
 * 单个 token 的**字节**上限（UTF-8）。
 *
 * 取 2046 的依据：PostgreSQL tsvector 的实测边界——2046 字节可索引，2047 字节起
 * 被**静默忽略**（仅打 NOTICE，不报错）。中文每字 3 字节，故约 682 字为上限。
 *
 * 为什么要在这里统一丢弃（而不是交给驱动）：
 *   1. **静默错误**——超长 token 落在短语查询中间时，PG 不会报错，而是把它吃掉
 *      并改变距离：`b <-> 超长 <-> c` 退化成 `'b' <2> 'c'`。这是"看起来成功"的错误结果，
 *      比报错更危险，必须在源头消除。
 *   2. **跨方言一致**——SQLite FTS5 无此限制；若不统一，同一查询在两方言下结果会不同。
 *      上限取两者中更严的一个。
 *
 * 代价：>2046 字节的连续字母数字串（如超长 base64、无分隔的长 URL）不可检索。
 * 这类串检索价值极低，判定为可接受。
 */
export const MAX_TOKEN_BYTES = 2046;

const withinLimit = (token: string): boolean =>
  Buffer.byteLength(token, 'utf8') <= MAX_TOKEN_BYTES;

/**
 * 切分为可检索形式（索引侧与查询侧共用）：
 * `你好 world 123` → `你 好 world 123`
 * 变体选择器/零宽字符等非汉字/字母/数字一律当分隔符丢弃。
 */
export function tokenize(text: string): string {
  const normalized = text
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, ' ') // 非汉字/字母/数字 → 分隔
    .replace(/[\u4e00-\u9fa5]/g, (c) => ` ${c} `) // 每个汉字独立成 token
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.split(' ').filter(withinLimit).join(' ');
}

/**
 * 同上，但返回 token 数组——供各检索策略拼装方言特有的查询语法。
 * token 只可能由汉字/字母/数字组成，可安全嵌入 SQL 字面量（无引号/操作符风险）。
 */
export function tokenizeList(text: string): string[] {
  const normalized = tokenize(text);
  return normalized ? normalized.split(' ') : [];
}
