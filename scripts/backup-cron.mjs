#!/usr/bin/env node
// scripts/backup-cron.mjs
// 定时备份的单一入口：**备份 + 轮转**一次做完。
//
// 为什么要有这个包装：crontab 里能写的只有一行命令，把"备份"和"淘汰"
// 拆成两条意味着两者可能只成功一半——备份成功但轮转没跑（磁盘满），
// 或轮转跑了但备份没成功（删掉旧的、新的没有，等于净损失）。
// 绑成一个原子步骤，定时任务才不会悄悄退化。
//
// 用法（crontab / systemd 都调它）：
//   node scripts/backup-cron.mjs
//   DB_URL=./data/app.db MEDIA_ROOT=./data/media node scripts/backup-cron.mjs
//
// 退出码：0 成功（含"本次无需处理"）；1 失败（cron 会把非 0 视为异常并留下痕迹）

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dbPath = process.env['DB_URL'] ?? './data/app.db';
const mediaRoot = process.env['MEDIA_ROOT'] ?? './data/media';
const backupsDir = process.env['BACKUP_DIR'] ?? './backups';

const absDb = resolve(ROOT, dbPath);
const absBackups = resolve(ROOT, backupsDir);

try {
  if (!existsSync(absDb)) {
    console.error(`❌ 数据库不存在：${absDb}`);
    console.error('   （服务是否从未启动过？备份无从谈起）');
    process.exit(1);
  }
  mkdirSync(absBackups, { recursive: true });

  console.log(`[backup-cron] 开始：${new Date().toISOString()}`);
  execFileSync('node', [join(ROOT, 'scripts', 'backup.mjs'), absDb, absBackups], {
    stdio: 'inherit',
    env: { ...process.env, MEDIA_ROOT: resolve(ROOT, mediaRoot) },
  });

  // 轮转失败不推翻已成功的备份——但必须让退出码非 0，让监控发现
  try {
    execFileSync('node', [join(ROOT, 'scripts', 'backup-rotate.mjs'), '--dir', absBackups], {
      stdio: 'inherit',
    });
  } catch (e) {
    console.error('❌ 轮转失败（备份本身已成功，磁盘可能将被占满）');
    process.exit(e.status ?? 1);
  }

  console.log(`[backup-cron] 完成：${new Date().toISOString()}`);
} catch (e) {
  console.error(`❌ 备份失败：${e.message}`);
  process.exit(e.status ?? 1);
}
