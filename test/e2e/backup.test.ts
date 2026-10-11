import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 备份/恢复/轮转的端到端测试。
 *
 * 为什么这些必须真跑脚本而不是测纯函数：备份的价值全在
 * "生成的快照能不能被独立打开并还原" 上。测函数只会得到
 * "函数返回了预期结构" 这种自欺欺人的绿灯。
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// args 形如 ['restore.mjs', '--list', dir]：第一个元素是脚本名，其余原样透传
const run = (args: [string, ...string[]], opts = {}) =>
  execFileSync('node', [join(ROOT, 'scripts', args[0]), ...args.slice(1)], {
    encoding: 'utf8',
    ...opts,
  });

describe('备份与恢复', () => {
  let work: string;
  let db: string;
  let media: string;
  let backups: string;

  /** 最新一份备份目录名（目录名即时间戳，字典序=时间序） */
  const latest = (dir = backups) => {
    const names = readdirSync(dir).sort().reverse();
    const n = names[0];
    if (!n) throw new Error(`备份目录为空：${dir}`);
    return n;
  };

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'cms-backup-'));
    db = join(work, 'app.db');
    media = join(work, 'media');
    backups = join(work, 'backups');
    mkdirSync(media, { recursive: true });
    writeFileSync(join(media, 'a.txt'), 'media-v1');

    // 造一个像样的库：业务表 + 模块私有表（回归此前 PG 溢出问题的场景）
    const d = new Database(db);
    d.exec(`CREATE TABLE entries (
      id TEXT PRIMARY KEY, slug TEXT, status TEXT, data TEXT,
      created_at INTEGER, updated_at INTEGER, deleted_at INTEGER DEFAULT 0)`);
    d.prepare(`INSERT INTO entries VALUES (?,?,?,?,?,?,0)`).run(
      'e1', 'hello', 'published', JSON.stringify({ title: '第一版' }), 1, 1);
    d.exec(`CREATE TABLE auth_users (id TEXT PRIMARY KEY, email TEXT, ts INTEGER)`);
    d.prepare(`INSERT INTO auth_users VALUES (?,?,?)`).run('u1', 'a@b.c', Date.now());
    d.close();
  });

  afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true });
  });

  const backupOnce = () => {
    execFileSync('node', [join(ROOT, 'scripts/backup.mjs'), db, backups], {
      stdio: 'pipe',
      env: { ...process.env, MEDIA_ROOT: media },
    });
    return latest();
  };

  it('备份产出自包含目录：DB 快照 + dump.json + 媒体 + 清单', () => {
    const stamp = backupOnce();
    const dir = join(backups, stamp);
    expect(existsSync(join(dir, 'app.db'))).toBe(true);
    expect(existsSync(join(dir, 'dump.json'))).toBe(true);
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(dir, 'media', 'a.txt'))).toBe(true);
  });

  it('快照是独立可打开的一致性副本（含大整数 epoch 未被截断）', () => {
    const stamp = backupOnce();
    const snap = new Database(join(backups, stamp, 'app.db'), { readonly: true });
    try {
      expect(snap.pragma('integrity_check', { simple: true })).toBe('ok');
      const ts = snap.prepare('SELECT ts FROM auth_users WHERE id=?').get('u1') as { ts: number };
      // epoch 毫秒必须完整落库：模块私有表 INTEGER 溢出问题会在此暴露
      expect(ts.ts).toBeGreaterThan(1_600_000_000_000);
    } finally {
      snap.close();
    }
  });

  it('同一秒内连续备份两次不撞名（VACUUM INTO 拒绝写已存在文件）', () => {
    // 回归：秒级时间戳会让定时任务的重试直接失败
    execFileSync('node', [join(ROOT, 'scripts/backup.mjs'), db, backups], {
      stdio: 'pipe',
      env: { ...process.env, MEDIA_ROOT: media },
    });
    expect(() =>
      execFileSync('node', [join(ROOT, 'scripts/backup.mjs'), db, backups], {
        stdio: 'pipe',
        env: { ...process.env, MEDIA_ROOT: media },
      })
    ).not.toThrow();
    const dirs = readdirSync(backups);
    expect(new Set(dirs).size).toBe(dirs.length); // 无重复目录
  });

  it('--list 列出可用备份', () => {
    backupOnce();
    const out = run(['restore.mjs', '--list', backups]);
    expect(out).toContain('可用备份');
    expect(out).toMatch(/\d{8}-\d{6}/);
  });

  it('--inspect 只读清单、不改动任何数据', () => {
    const stamp = latest();
    const before = readdirSync(work).sort();
    const out = run(['restore.mjs', join(backups, stamp), '--inspect']);
    expect(out).toContain('备份清单');
    expect(readdirSync(work).sort()).toEqual(before); // 无副作用
  });

  it('--dry-run 完整打出计划但不动文件', () => {
    const stamp = latest();
    const target = join(work, 'restored-dry.db');
    const out = run(['restore.mjs', join(backups, stamp), '--db', target, '--dry-run']);
    expect(out).toContain('演练模式');
    expect(out).toContain('integrity_check = ok');
    expect(existsSync(target)).toBe(false); // 演练不落盘
  });

  it('真实恢复：数据回到备份时刻的值（备份后新增的内容不保留）', () => {
    const stamp = backupOnce(); // 这一刻的快照

    // 备份之后再写入，并删掉媒体文件——恢复后应回到备份时刻
    const d = new Database(db);
    d.prepare(`INSERT INTO entries VALUES (?,?,?,?,?,?,0)`).run(
      'e2', 'after-backup', 'draft', JSON.stringify({ title: '备份之后' }), 2, 2);
    d.close();
    rmSync(join(media, 'a.txt'));

    const target = join(work, 'restored.db');
    const mediaTarget = join(work, 'media-restored');
    run(['restore.mjs', join(backups, stamp), '--db', target, '--media-root', mediaTarget, '--yes']);

    const r = new Database(target, { readonly: true });
    try {
      const ids = (r.prepare('SELECT id FROM entries ORDER BY id').all() as { id: string }[]).map((x) => x.id);
      expect(ids).toEqual(['e1']); // e2 是备份之后的写入，不应出现
    } finally {
      r.close();
    }
    expect(existsSync(join(mediaTarget, 'a.txt'))).toBe(true); // 媒体一并还原
  });

  it('恢复前自动留底：原有库被移到 pre-restore-* 而不是被销毁', () => {
    const stamp = latest();
    const target = join(work, 'restored-again.db');
    // 先造一个"当前生产库"，再恢复覆盖它
    const d = new Database(target);
    d.exec('CREATE TABLE marker (x TEXT)');
    d.prepare('INSERT INTO marker VALUES (?)').run('important');
    d.close();

    run(['restore.mjs', join(backups, stamp), '--db', target, '--yes']);
    const keeps = readdirSync(work).filter((n) => n.startsWith('pre-restore-'));
    expect(keeps.length).toBe(1);
    const keepName = keeps[0];
    if (!keepName) throw new Error('未生成恢复前留底');
    const keep = new Database(join(work, keepName), { readonly: true });
    try {
      expect((keep.prepare('SELECT x FROM marker').get() as { x: string }).x).toBe('important');
    } finally {
      keep.close();
    }
  });

  it('恢复自检会报出与清单不一致的表（不静默放过）', () => {
    const stamp = latest();
    const target = join(work, 'restored-check.db');
    run(['restore.mjs', join(backups, stamp), '--db', target, '--yes']);
    // 恢复后在目标库追加一行，再看自检输出
    const d = new Database(target);
    d.prepare(`INSERT INTO entries VALUES (?,?,?,?,?,?,0)`).run(
      'e3', 'post', 'draft', '{}', 3, 3);
    d.close();

    const out = run(['restore.mjs', join(backups, stamp), '--db', target, '--yes']);
    expect(out).toContain('恢复后自检');
  });

  it('损坏的快照被拒绝：不会拿坏备份覆盖生产库', () => {
    const stamp = latest();
    const broken = join(work, 'broken-backup');
    mkdirSync(broken, { recursive: true });
    // 复制一份再人为写坏头部
    const good = new Database(join(backups, stamp, 'app.db'), { readonly: true });
    try {
      good.exec(`VACUUM INTO '${join(broken, 'app.db')}'`);
    } finally {
      good.close();
    }
    const buf = readFileSync(join(broken, 'app.db'));
    buf.fill(0x41, 100, 4000); // 破坏页内容
    writeFileSync(join(broken, 'app.db'), buf);
    writeFileSync(join(broken, 'manifest.json'), JSON.stringify({ createdAt: Date.now(), tables: {}, source: {}, snapshot: { bytes: buf.length } }));

    const target = join(work, 'must-stay.db');
    const d2 = new Database(target);
    d2.exec('CREATE TABLE keepme (x TEXT)');
    d2.prepare('INSERT INTO keepme VALUES (?)').run('must-survive');
    d2.close();

    let failed = false;
    try {
      run(['restore.mjs', broken, '--db', target, '--yes']);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    // 目标库应原封不动（且不产生 pre-restore 留底——恢复压根没开始）
    const after = new Database(target, { readonly: true });
    try {
      expect((after.prepare('SELECT x FROM keepme').get() as { x: string }).x).toBe('must-survive');
    } finally {
      after.close();
    }
    });
});

describe('备份轮转（GFS 保留）', () => {
  const mk = (dir: string, names: string[]) => {
    mkdirSync(dir, { recursive: true });
    for (const n of names) {
      const p = join(dir, n);
      mkdirSync(p, { recursive: true });
      writeFileSync(join(p, 'manifest.json'), JSON.stringify({ createdAt: 0, tables: {} }));
      writeFileSync(join(p, 'app.db'), Buffer.alloc(1024));
    }
  };

  it('--dry-run 只报告不删除', () => {
    const w = mkdtempSync(join(tmpdir(), 'cms-rot-'));
    try {
      const dir = join(w, 'backups');
      mk(dir, Array.from({ length: 10 }, (_, i) => `202610${String(i + 1).padStart(2, '0')}-000000`));
      const out = execFileSync('node', [join(ROOT, 'scripts/backup-rotate.mjs'), '--dir', dir, '--daily', '3', '--dry-run'], { encoding: 'utf8' });
      expect(out).toContain('演练');
      expect(readdirSync(dir).length).toBe(10); // 一个没删
    } finally {
      rmSync(w, { recursive: true, force: true });
    }
  });

  it('超出保留份数的旧备份被淘汰，且最新一份永不删除', () => {
    const w = mkdtempSync(join(tmpdir(), 'cms-rot-'));
    try {
      const dir = join(w, 'backups');
      mk(dir, Array.from({ length: 10 }, (_, i) => `202610${String(i + 1).padStart(2, '0')}-000000`));
      execFileSync('node', [join(ROOT, 'scripts/backup-rotate.mjs'), '--dir', dir, '--hourly', '0', '--daily', '2', '--weekly', '0', '--monthly', '0'], { stdio: 'pipe' });

      const left = readdirSync(dir).sort();
      expect(left.length).toBeLessThan(10);
      expect(left).toContain('20261010-000000'); // 最新一份必留
      expect(left).not.toContain('20261001-000000'); // 最旧一份淘汰
    } finally {
      rmSync(w, { recursive: true, force: true });
    }
  });

  it('空目录/无有效备份不报错', () => {
    const w = mkdtempSync(join(tmpdir(), 'cms-rot-'));
    try {
      const dir = join(w, 'empty');
      mkdirSync(dir);
      const out = execFileSync('node', [join(ROOT, 'scripts/backup-rotate.mjs'), '--dir', dir], { encoding: 'utf8' });
      expect(out).toContain('没有');
    } finally {
      rmSync(w, { recursive: true, force: true });
    }
  });
});
