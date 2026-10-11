#!/usr/bin/env node
// scripts/backup.mjs
// 单机数据备份：DB 一致性快照 + 全表 JSON + 媒体文件 + 清单。
//
// 用法：
//   node scripts/backup.mjs                    # 默认 ./data/app.db → ./backups/<时间>/
//   node scripts/backup.mjs <db> [outDir]
//   MEDIA_ROOT=./data/media node scripts/backup.mjs
//
// 关键点：DB 用 `VACUUM INTO` 生成一致性快照——**服务运行中也能安全备份**
// （VACUUM 在事务内完成，不需要停服，也不会拷到写了一半的页）。
// 这一条正是"单机 SQLite 场景"下备份的正确姿势，比 `cp app.db` 可靠。

import Database from 'better-sqlite3';
import { mkdirSync, cpSync, existsSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const dbPath = process.argv[2] ?? './data/app.db';
const outRoot = process.argv[3] ?? './backups';
const mediaRoot = process.env['MEDIA_ROOT'] ?? './data/media';

if (!existsSync(dbPath)) {
  console.error(`❌ 找不到数据库：${dbPath}`);
  process.exit(1);
}

// 时间戳目录：20261011-203116
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
const dir = join(outRoot, stamp);
mkdirSync(dir, { recursive: true });

const db = new Database(dbPath, { readonly: true });

try {
  // ---------- 1) DB 一致性快照 ----------
  const snapshot = join(dir, 'app.db');
  db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);

  // ---------- 2) 全表 JSON（可读、可迁移、可 diff） ----------
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    )
    .all()
    .map((r) => r.name);

  const dump = {};
  const tableStats = {};
  const skipped = [];
  for (const t of tables) {
    try {
      const rows = db.prepare(`SELECT * FROM "${t}"`).all();
      dump[t] = rows;
      tableStats[t] = rows.length;
    } catch (e) {
      // FTS5 影子表等不支持直接 SELECT * 的对象：跳过并在清单里记录
      skipped.push({ table: t, reason: (e).message.slice(0, 80) });
    }
  }
  writeFileSync(join(dir, 'dump.json'), JSON.stringify(dump, null, 2));

  // ---------- 3) 媒体文件 ----------
  let mediaFiles = 0;
  if (existsSync(mediaRoot)) {
    cpSync(mediaRoot, join(dir, 'media'), { recursive: true });
    const countFiles = (p) => {
      const st = statSync(p);
      if (!st.isDirectory()) return 1;
      // 目录递归计数（媒体按租户分目录）
      let n = 0;
      for (const name of readdirSync(p)) n += countFiles(join(p, name));
      return n;
    };
    try {
      mediaFiles = countFiles(mediaRoot);
    } catch {
      mediaFiles = -1; // 统计失败不影响备份本身
    }
  }

  // ---------- 4) 清单 ----------
  const meta = {
    createdAt: Date.now(),
    source: { db: dbPath, media: existsSync(mediaRoot) ? mediaRoot : null },
    snapshot: { file: 'app.db', bytes: statSync(snapshot).size },
    tables: tableStats,
    skipped,
    mediaFiles,
    note: 'DB 快照经 VACUUM INTO 生成（服务运行中安全）；dump.json 为全表 JSON，可迁移/人工核对。',
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(meta, null, 2));

  const totalRows = Object.values(tableStats).reduce((a, b) => a + b, 0);
  console.log(`✅ 备份完成 → ${dir}`);
  console.log(`   DB 快照   ${basename(snapshot)}  ${(meta.snapshot.bytes / 1024).toFixed(0)} KB`);
  console.log(`   表         ${Object.keys(tableStats).length} 张 / ${totalRows} 行 → dump.json`);
  if (mediaFiles > 0) console.log(`   媒体       ${mediaFiles} 个文件 → media/`);
  if (skipped.length > 0) {
    console.log(`   （跳过 ${skipped.length} 个不可直读对象：${skipped.map((s) => s.table).join(', ')}）`);
  }
} finally {
  db.close();
}
