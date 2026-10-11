import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * 交付测试（发版前跑）：验证"自包含包"在隔离目录能起来。
 * 注意：这是慢测试（构建 + 解压 + 启动），不进日常 CI。
 */
describe('自包含交付', () => {
  let work: string;
  const tarballName = 'headless-cms-0.1.0.tar.gz';
  const tarball = join(ROOT, 'dist', tarballName);

  beforeAll(() => {
    // 构建压缩包
    execFileSync('make', ['package'], { cwd: ROOT, stdio: 'pipe' });
    work = mkdtempSync(join(tmpdir(), 'cms-deliver-'));
    // 隔离解压
    execFileSync('tar', ['-xzf', tarball, '-C', work]);
    mkdirSync(join(work, 'data'), { recursive: true });
  }, 180_000);

  afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true });
    rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
    rmSync(join(ROOT, 'data'), { recursive: true, force: true });
  });

  it('压缩包已产出且包含 app.mjs 与 node_modules', () => {
    expect(existsSync(tarball)).toBe(true);
    expect(existsSync(join(work, 'app.mjs'))).toBe(true);
    expect(existsSync(join(work, 'node_modules'))).toBe(true);
  });

  it('在隔离目录可直接运行并自检通过（不依赖源码目录）', () => {
    const out = execFileSync('node', ['app.mjs'], {
      cwd: work,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(out).toContain('[kernel] 已挂载模块: storage');
    expect(out).toContain('[kernel] 已挂载模块: content');
    expect(out).toContain('[selfcheck] OK');
  });
});
