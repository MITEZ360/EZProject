// modules/search/internal/tokenize.ts
// 全文检索的切分策略（纯函数，索引与查询共用同一套，否则对不上）。
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
 * 切分为 FTS5 可检索的形式：
 * `你好 world 123` → `你 好 world 123`
 * 变体选择器/零宽字符等一律当分隔符丢弃。
 */
export function tokenize(text: string): string {
  return text
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, ' ') // 非汉字/字母/数字 → 分隔
    .replace(/[\u4e00-\u9fa5]/g, (c) => ` ${c} `) // 每个汉字独立成 token
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 查询文本 → FTS5 MATCH 表达式（短语匹配，token 必须相邻）。
 * 用 phrase 而非 AND：中文搜「世界」若拆成 `"世" AND "界"` 会命中「世…界」这类
 * 不相邻文本，噪音过大；短语语义符合「搜什么就匹配什么」的直觉。
 * 引号做转义，避免查询串被当作 FTS5 语法。
 */
export function toMatchExpr(text: string): string {
  const tokens = tokenize(text);
  if (!tokens) return '';
  return `"${tokens.replace(/"/g, '""')}"`;
}
