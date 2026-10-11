#!/usr/bin/env node
// scripts/restore.mjs
// 从备份目录恢复：DB 快照 + 媒体文件 + 恢复前自动留一份"恢复前快照"。
//
// 用法：
//   node scripts/restore.mjs --list [backupsDir]              # 列出可用备份（按时间倒序）
//   node scripts/restore.mjs --inspect <备份目录>              # 只看清单，不动数据
//   node scripts/restore.mjs <备份目录> --db ./data/app.db     # 恢复 DB
//   node scripts/restore.mjs <备份目录> --db ... --media-root ./data/media
//   node scripts/restore.mjs <备份目录> --dry-run             # 只演练，会明确打出将做什么
//   node scripts/restore.mjs <备份目录> --yes                  # 跳过交互确认（给自动化用）
//
// 为什么恢复要先备份：恢复是**唯一会破坏现有数据**的操作。
// 若恢复中途失败或恢复错备份目录，原库已不可得——所以先把当前状态
// VACUUM INTO 存一份，回退路径永远存在。
//
// 与 backup.mjs 的分工：
//   backup.mjs  —— 正向：一致性快照（运行中也安全）
//   restore.mjs —— 反向：还原 + 校验 + 可回退

import Database from 'better-sqlite3';
import {
  mkdirSync,
  cpSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  writeSync,
  readSync,
} from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';

// ---------- 参数解析 ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};

const listOnly = flag('list');
const inspectOnly = flag('inspect');
const dryRun = flag('dry-run');
const assumeYes = flag('yes');

// 取值型选项（后面跟一个值），用于区分位置参数
const valueOpts = new Set(['db', 'media-root', 'out', 'backups']);
const positionals = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const n = a.slice(2);
    if (valueOpts.has(n) && argv[i + 1] && !argv[i + 1].startsWith('--')) i++;
    continue;
  }
  positionals.push(a);
}

const backupsDir = resolve(opt('backups', positionals[1] ?? positionals[0] ?? './backups'));
const dbTarget = resolve(opt('db', './data/app.db'));
const mediaTarget = opt('media-root', './data/media');

// ---------- 子命令 ----------
if (listOnly) {
  listBackups(backupsDir);
  process.exit(0);
}

const backupDir = positionals[0]
  ? resolve(positionals[0])
  : (() => {
      // 未指定目录：自动取最新一份（恢复场景下最常见诉求）
      const latest = latestBackup(backupsDir);
      if (!latest) {
        console.error(`❌ ${backupsDir} 下没有可用备份。先执行：make backup`);
        process.exit(1);
      }
      return latest;
    })();

const manifestPath = join(backupDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`❌ 不是备份目录（缺 manifest.json）：${backupDir}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (inspectOnly) {
  showManifest(backupDir, manifest);
  process.exit(0);
}

const snapshot = join(backupDir, 'app.db');
if (!existsSync(snapshot)) {
  console.error(`❌ 备份缺少 DB 快照：${snapshot}`);
  process.exit(1);
}

// ---------- 恢复前自检：快照本身可读且完整 ----------
// 只跑 integrity_check 不够：结构完好但**页内容损坏**的库仍可能返回 ok，
// 真正崩在恢复后第一次读数据上——那时生产库已被覆盖，回退也未必救得回来。
// 所以这里必须**把每张表都真读一遍**（count(*) 会触页），再放行。
const probe = (() => {
  try {
    return new Database(snapshot, { readonly: true });
  } catch (e) {
    // 快照连打开都失败（页损坏 / 文件截断）：直接判定不可用，绝不覆盖目标库
    console.error(`❌ 备份快照无法打开：${e.message}`);
    console.error('   不要用它覆盖生产库。请换一份备份，或从 dump.json 走重建路线。');
    process.exit(1);
  }
})();
let integrity;
let snapshotTables = 0;
const unreadable = [];
try {
  integrity = probe.pragma('integrity_check', { simple: true });
  const names = probe
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all()
    .map((r) => r.name);
  snapshotTables = names.length;
  for (const n of names) {
    try {
      probe.prepare(`SELECT count(*) AS n FROM "${n}"`).get();
    } catch (e) {
      // FTS5 影子表等不可直读对象不算损坏；其余一律视为快照不可用
      if (!/malformed|no such table|does not exist/i.test(e.message)) {
        unreadable.push({ table: n, reason: e.message.slice(0, 80) });
      }
    }
  }
} catch (e) {
  // integrity_check 自己都可能抛（严重页损坏）——同样判为不可用，不放行
  console.error(`❌ 备份快照校验失败：${e.message}`);
  console.error('   不要用它覆盖生产库。请换一份备份，或从 dump.json 走重建路线。');
  process.exit(1);
} finally {
  try {
    probe.close();
  } catch {
    /* 损坏库关闭失败可忽略 */
  }
}

if (integrity !== 'ok' || unreadable.length > 0) {
  console.error(`❌ 备份快照未通过完整性检查：integrity_check=${integrity}`);
  for (const u of unreadable) console.error(`   表 ${u.table} 读取失败：${u.reason}`);
  console.error('   不要用它覆盖生产库。请换一份备份，或从 dump.json 走重建路线。');
  process.exit(1);
}

// ---------- 干跑：把"将做什么"完整打出来 ----------
const mediaSrc = join(backupDir, 'media');
const willRestoreMedia = existsSync(mediaSrc) && existsSync(dirname(mediaTarget));
const plan = [
  `目标库    ${dbTarget}`,
  `目标媒体  ${willRestoreMedia ? mediaTarget : '（跳过：备份内无媒体目录）'}`,
  `快照校验  integrity_check = ${integrity}，${snapshotTables} 张表`,
  `恢复前留底 ${join(dirname(dbTarget), `pre-restore-${stamp()}.db`)}`,
];

if (dryRun) {
  console.log('🔍 演练模式（未做任何改动）：');
  plan.forEach((l) => console.log(`   · ${l}`));
  process.exit(0);
}

if (!assumeYes && !confirm(`将覆盖 ${dbTarget}，继续？输入 yes 确认：`)) {
  console.log('已取消。');
  process.exit(1);
}

// ---------- 执行 ----------
mkdirSync(dirname(dbTarget), { recursive: true });

// 1) 先给现有库留底（回退路径）
let keepPath = null;
if (existsSync(dbTarget)) {
  keepPath = uniquePath(join(dirname(dbTarget), `pre-restore-${stamp()}.db`));
  const cur = new Database(dbTarget, { readonly: true });
  try {
    cur.exec(`VACUUM INTO '${keepPath.replace(/'/g, "''")}'`);
  } finally {
    cur.close();
  }
  console.log(`↩️  恢复前留底已保存：${keepPath}`);
}

// 2) 覆盖 DB 快照
//    先移到一边再拷，而不是直接写——中断时不会留下半截文件。
if (existsSync(dbTarget)) rmSync(dbTarget, { force: true });
cpSync(snapshot, dbTarget);
console.log(`✅ DB 已恢复：${dbTarget}`);

// 3) 媒体
if (willRestoreMedia) {
  const tmp = `${mediaTarget}.restoring`;
  rmSync(tmp, { recursive: true, force: true });
  cpSync(mediaSrc, tmp, { recursive: true });
  rmSync(mediaTarget, { recursive: true, force: true });
  cpSync(tmp, mediaTarget, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
  console.log(`✅ 媒体已恢复：${mediaTarget}`);
}

// ---------- 恢复后自检：行数与备份清单对齐 ----------
const after = (() => {
  try {
    return new Database(dbTarget, { readonly: true });
  } catch (e) {
    console.error(`❌ 恢复后的库无法打开：${e.message}`);
    if (keepPath) console.error(`   回退：把留底拷回原位  ${keepPath}  →  ${dbTarget}`);
    process.exit(1);
  }
})();
try {
  const rows = {};
  let mismatched = 0;
  for (const [t, expected] of Object.entries(manifest.tables ?? {})) {
    let got = -1;
    try {
      got = after.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n;
    } catch {
      got = -1; // FTS5 影子表等不可直读对象
    }
    rows[t] = got;
    if (got >= 0 && expected >= 0 && got !== expected) mismatched++;
  }
  const total = Object.values(rows).reduce((a, b) => Math.max(a, b), 0);
  console.log(`🔎 恢复后自检：${Object.keys(rows).length} 张表可读，合计 ${total} 行`);
  if (mismatched > 0) {
    console.warn(
      `⚠️  ${mismatched} 张表行数与备份清单不一致（备份之后可能又有新写入，属正常）：`
    );
    for (const [t, got] of Object.entries(rows)) {
      const exp = manifest.tables[t];
      if (got >= 0 && exp >= 0 && got !== exp) console.log(`     ${t}: 备份 ${exp} → 恢复后 ${got}`);
    }
  }
} finally {
  after.close();
}

writeFileSync(
  join(backupDir, 'restored.json'),
  JSON.stringify({ restoredAt: Date.now(), target: dbTarget, media: willRestoreMedia, keep: keepPath }, null, 2)
);

console.log('\n提示：服务需重启才能读到恢复后的数据。');
if (keepPath) console.log(`      如需回退，恢复前留底在：${keepPath}`);

// ---------- 辅助 ----------
function stamp() {
  // 毫秒精度：秒级会在"同一秒内连续两次恢复"时撞名
  return new Date().toISOString().slice(0, 23).replace(/[-:]/g, '').replace('T', '-').replace('.', '');
}

/** 目标已存在时追加序号——VACUUM INTO 不允许覆盖已存在文件 */
function uniquePath(p) {
  if (!existsSync(p)) return p;
  const base = p.replace(/\.db$/, '');
  for (let i = 2; i < 100; i++) {
    const cand = `${base}-${i}.db`;
    if (!existsSync(cand)) return cand;
  }
  return `${base}-${Date.now()}.db`;
}

function latestBackup(root) {
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root)
    .map((n) => join(root, n))
    .filter((p) => existsSync(join(p, 'manifest.json')))
    .sort()
    .reverse();
  return dirs[0] ?? null;
}

function listBackups(root) {
  if (!existsSync(root)) {
    console.error(`❌ 目录不存在：${root}`);
    process.exit(1);
  }
  const dirs = readdirSync(root)
    .map((n) => join(root, n))
    .filter((p) => statSync(p).isDirectory())
    .sort()
    .reverse();
  if (dirs.length === 0) {
    console.log(`（${root} 下暂无备份）`);
    return;
  }
  console.log(`可用备份（${dirs.length} 份，最新在前）：\n`);
  for (const d of dirs) {
    const mp = join(d, 'manifest.json');
    let desc = '（无 manifest.json，视为无效备份）';
    if (existsSync(mp)) {
      try {
        const m = JSON.parse(readFileSync(mp, 'utf8'));
        const rows = Object.values(m.tables ?? {}).reduce((a, b) => a + Math.max(b, 0), 0);
        desc = `${Object.keys(m.tables ?? {}).length} 表 / ${rows} 行` +
          (m.mediaFiles > 0 ? ` / ${m.mediaFiles} 媒体` : '') +
          ` / 快照 ${Math.round((m.snapshot?.bytes ?? 0) / 1024)}KB`;
      } catch {
        desc = '（manifest.json 解析失败）';
      }
    }
    console.log(`  ${basename(d)}   ${desc}`);
  }
}

function showManifest(dir, m) {
  console.log(`备份清单：${dir}\n`);
  console.log(`  生成时间  ${new Date(m.createdAt).toISOString()}`);
  console.log(`  来源      db=${m.source?.db}  media=${m.source?.media ?? '无'}`);
  console.log(`  快照      ${m.snapshot?.file}（${Math.round((m.snapshot?.bytes ?? 0) / 1024)}KB）`);
  console.log(`  媒体文件  ${m.mediaFiles}`);
  if (m.skipped?.length) console.log(`  跳过对象  ${m.skipped.map((s) => s.table).join(', ')}`);
  console.log('  表统计：');
  for (const [t, n] of Object.entries(m.tables ?? {})) console.log(`    ${String(n).padStart(6)}  ${t}`);
  console.log(`\n恢复命令：node scripts/restore.mjs ${dir} --db ./data/app.db --dry-run`);
}

function confirm(msg) {
  // 非 TTY（CI/管道）下不静默通过：必须显式 --yes
  if (!process.stdin.isTTY) {
    console.error('❌ 非交互环境需显式加 --yes 确认恢复。');
    return false;
  }
  const buf = Buffer.alloc(64);
  try {
    writeSync(2, msg);
    const n = readSync(0, buf, 0, 64, null);
    return buf.slice(0, n).toString().trim() === 'yes';
  } catch {
    return false;
  }
}
