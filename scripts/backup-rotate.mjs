#!/usr/bin/env node
// scripts/backup-rotate.mjs
// 备份保留策略：定时备份的另一半。没有淘汰策略的定时备份等于慢性自杀
// （每天一份 × 一年 = 把磁盘占满，最需要备份的时候反而没有空间）。
//
// 策略：GFS（Grailder-Foster-Sadtler）保留法——
//   - 每小时留最近 N 份
//   - 每天留最近 N 份
//   - 每周留最近 N 份
//   - 每月留最近 N 份
// 超出即删，**永不删除最后一次备份**（最后一份是最后的救命稻草）。
//
// 用法：
//   node scripts/backup-rotate.mjs                    # 默认 ./backups，hourly=24 daily=14 weekly=8 monthly=12
//   node scripts/backup-rotate.mjs --dir ./backups --daily 30 --dry-run
//   KEEP_HOURLY=0 KEEP_DAILY=0 ... node scripts/backup-rotate.mjs   # 关掉某档（0 = 不保留该档）

import { readdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const num = (n, d) => {
  const v = Number(opt(n, process.env[`KEEP_${n.toUpperCase()}`] ?? d));
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : d;
};

const dir = opt('dir', './backups');
const keep = {
  hourly: num('hourly', 24),
  daily: num('daily', 14),
  weekly: num('weekly', 8),
  monthly: num('monthly', 12),
};
const dryRun = flag('dry-run');

if (!existsSync(dir)) {
  console.error(`❌ 备份目录不存在：${dir}`);
  process.exit(1);
}

// 备份目录名形如 20261011-203116，可直接按名字排序 = 按时间排序
const all = readdirSync(dir)
  .filter((n) => /^\d{8}-\d{6}$/.test(n))
  .sort()
  .reverse(); // 最新在前

if (all.length === 0) {
  console.log(`（${dir} 下没有形如 20261011-203116 的备份，跳过）`);
  process.exit(0);
}

const ts = (n) => {
  const m = n.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
};

// 逐档挑"该档内最新 N 份"，各档命中的并集即保留集合。
// 逐档按槽位递增而非"距今 N 天"——备份可能断档，按时间窗会连带删掉
// 该窗口内唯一一份可用备份。
const tiers = [
  ['hourly', keep.hourly],
  ['daily', keep.daily],
  ['weekly', keep.weekly],
  ['monthly', keep.monthly],
];

const keepSet = new Set();
const tierHits = {};
for (const [tier, n] of tiers) {
  if (n === 0) {
    tierHits[tier] = 0;
    continue;
  }
  const seenKeys = new Set(); // 同一时间桶只占一个槽位
  const hits = [];
  for (const name of all) {
    if (hits.length >= n) break;
    const d = ts(name);
    let bucket;
    if (tier === 'hourly') bucket = `${d.getFullYear()}${d.getMonth()}${d.getDate()}${d.getHours()}`;
    else if (tier === 'daily') bucket = `${d.getFullYear()}${d.getMonth()}${d.getDate()}`;
    else if (tier === 'weekly') {
      const jan1 = new Date(d.getFullYear(), 0, 1);
      bucket = `${d.getFullYear()}-W${Math.ceil(((d - jan1) / 864e5 + jan1.getDay() + 1) / 7)}`;
    } else bucket = `${d.getFullYear()}${d.getMonth()}`; // monthly：月
    if (seenKeys.has(bucket)) continue;
    seenKeys.add(bucket);
    hits.push(name);
    keepSet.add(name);
  }
  tierHits[tier] = hits.length;
}

// 最新一份无条件保留
keepSet.add(all[0]);

const remove = all.filter((n) => !keepSet.has(n));

console.log(`备份目录 ${dir}：共 ${all.length} 份`);
console.log(
  `  保留档位  小时 ${keep.hourly} / 天 ${keep.daily} / 周 ${keep.weekly} / 月 ${keep.monthly}` +
    `  → 命中 ${Object.entries(tierHits).map(([k, v]) => `${k} ${v}`).join('，')}`
);
console.log(`  保留 ${keepSet.size} 份，淘汰 ${remove.length} 份${dryRun ? '（演练，未删除）' : ''}`);

let freed = 0;
for (const name of remove) {
  const p = join(dir, name);
  try {
    const bytes = dirSize(p);
    freed += bytes;
    if (!dryRun) rmSync(p, { recursive: true, force: true });
  } catch (e) {
    console.error(`   ⚠️  ${basename(p)} 删除失败：${e.message}`);
  }
}
if (remove.length > 0) {
  console.log(`   释放 ${(freed / 1024 / 1024).toFixed(1)} MB`);
}
console.log(remove.length === 0 ? '无需淘汰。' : dryRun ? '演练结束（加 --dry-run 之外的实跑才会真删）。' : '✅ 淘汰完成。');

function dirSize(p) {
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const name of readdirSync(p)) n += dirSize(join(p, name));
  return n;
}
