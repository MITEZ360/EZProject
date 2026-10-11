#!/usr/bin/env node
// 策略模式未被破坏：业务代码不得出现方言分支 if (dialect === ...)。
// 唯一允许出现方言判断的地方：modules/storage/factory.ts 与 registry.ts。
// 用法：node scripts/check-no-dialect.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['kernel', 'modules', 'scenarios'];
const ALLOW = [
  join('modules', 'storage', 'factory.ts'),
  join('modules', 'storage', 'registry.ts'),
];

const DIALECT_RE = /(dialect\s*===|dialect\s*==|===\s*'sqlite'|===\s*'postgres'|===\s*'mysql')/;

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
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collect(full));
    else if (/\.ts$/.test(name)) out.push(full);
  }
  return out;
}

function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const hits = [];
for (const dir of SCAN_DIRS) {
  for (const file of collect(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    if (ALLOW.includes(rel)) continue;
    const src = stripNoise(readFileSync(file, 'utf8'));
    src.split('\n').forEach((line, i) => {
      if (DIALECT_RE.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
}

if (hits.length > 0) {
  console.error('❌ 策略模式被破坏：业务代码出现方言分支\n');
  console.error(hits.join('\n'));
  console.error('\n方言判断必须收敛到 modules/storage/factory.ts 一处。');
  process.exit(1);
}
console.log('✅ 无方言分支扫描通过');
