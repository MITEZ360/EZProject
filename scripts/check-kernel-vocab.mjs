#!/usr/bin/env node
// 宪法四：内核不出现业务词汇。
// 扫描 kernel/ 目录的源码，命中业务词即失败。
// 用法：node scripts/check-kernel-vocab.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const KERNEL_DIR = join(ROOT, 'kernel');

// 业务词汇黑名单（小写、词边界匹配）。
// 只放"业务义且低歧义"的词；中性词（entity/field/event/principal/store）允许。
// 注意：高歧义词不进黑名单，避免误报——
//   'order'（排序 vs 订单）、'post'（提交 vs 文章）、'tag'（标签机制 vs 业务标签）
//   这些在通用代码里太常见，交给人工与"契约快照"把关，不上自动扫描。
const FORBIDDEN = [
  'article', 'blog', 'invoice', 'payment', 'billing',
  'comment', 'category', 'customer', 'employee', 'knowledge',
];

const WORD_RE = new RegExp(`\\b(${FORBIDDEN.join('|')})\\b`, 'i');

/** 递归收集 .ts 文件 */
function collect(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // kernel/ 尚未创建时跳过
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collect(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** 去掉注释与字符串，避免误报（粗粒度即可） */
function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const files = collect(KERNEL_DIR);
const hits = [];
for (const file of files) {
  const src = stripNoise(readFileSync(file, 'utf8'));
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    const m = line.match(WORD_RE);
    if (m) hits.push(`${relative(ROOT, file)}:${i + 1}: 业务词 "${m[1]}" -> ${line.trim()}`);
  });
}

if (hits.length > 0) {
  console.error('❌ 宪法四违规：内核出现业务词汇\n');
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log(`✅ 内核词汇扫描通过（检查 ${files.length} 个文件）`);
