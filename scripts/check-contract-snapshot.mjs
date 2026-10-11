#!/usr/bin/env node
// 契约签名快照比对：内核契约（kernel/contracts + kernel/primitives）的公开签名
// 一旦变化，说明"内核契约演进"，需要显式确认。
// 用法：
//   生成/更新快照：node scripts/check-contract-snapshot.mjs --update
//   校验：        node scripts/check-contract-snapshot.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const TARGETS = [join(ROOT, 'kernel', 'contracts'), join(ROOT, 'kernel', 'primitives')];
const SNAPSHOT = join(ROOT, 'kernel', 'contracts.snapshot.json');
const UPDATE = process.argv.includes('--update');

function collect(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (name.endsWith('.ts') && !name.endsWith('.schema.ts')) out.push(full);
  }
  return out;
}

/** 抽取 interface / type / export const 的"签名行"，忽略实现细节 */
function signatures(src) {
  const sigs = [];
  const lines = src.split('\n');
  let capturing = false;
  let buf = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^export\s+(interface|type|abstract class)\b/.test(trimmed) ||
        /^export\s+(const|function)\b/.test(trimmed)) {
      capturing = true;
      buf = trimmed;
      if (/[;{}]\s*$/.test(trimmed) || trimmed.endsWith(';')) {
        sigs.push(normalize(buf));
        capturing = false;
        buf = '';
      }
      continue;
    }
    if (capturing) {
      buf += ' ' + trimmed;
      if (/[;{}]\s*$/.test(trimmed)) {
        sigs.push(normalize(buf));
        capturing = false;
        buf = '';
      }
    }
  }
  return sigs;
}

function normalize(s) {
  return s.replace(/\s+/g, ' ').trim();
}

const manifest = {};
for (const dir of TARGETS) {
  for (const file of collect(dir)) {
    const rel = relative(ROOT, file).split('\\').join('/');
    manifest[rel] = signatures(readFileSync(file, 'utf8'));
  }
}

const next = JSON.stringify(manifest, null, 2) + '\n';

if (UPDATE) {
  mkdirSync(join(ROOT, 'kernel'), { recursive: true });
  writeFileSync(SNAPSHOT, next);
  console.log(`✅ 已更新契约快照：${relative(ROOT, SNAPSHOT)}`);
  process.exit(0);
}

if (!existsSync(SNAPSHOT)) {
  console.error('❌ 未找到契约快照。请先运行：node scripts/check-contract-snapshot.mjs --update');
  process.exit(1);
}

const prev = readFileSync(SNAPSHOT, 'utf8');
if (prev !== next) {
  console.error('❌ 内核契约签名发生变化（说明内核契约演进）。');
  console.error('   若确属有意变更，请在 PR 描述中说明"内核为何必须改"，然后执行：');
  console.error('     node scripts/check-contract-snapshot.mjs --update');
  // 打印差异摘要
  const a = JSON.parse(prev);
  const b = manifest;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = JSON.stringify(a[key] ?? null);
    const bv = JSON.stringify(b[key] ?? null);
    if (av !== bv) console.error(`   ~ ${key}`);
  }
  process.exit(1);
}
console.log('✅ 契约签名快照一致');
