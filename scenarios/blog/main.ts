// scenarios/blog/main.ts
// 可运行入口：启动博客场景（自包含交付物的入口）。
// 默认 SQLite、零配置；可用环境变量切库（切库需已实现对应驱动）。
//
// 注意：环境变量读取用 process.env（兼容 Node），不使用 Bun.env。

import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { createBlogApp } from './index.js';
import { createBlogFront } from './front/index.js';
import { HttpTokens } from '@modules/http/index.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { CacheProvider } from '@kernel/contracts/cache.contract.js';
import { Tokens } from '@kernel/registry.js';

async function main(): Promise<void> {
  const dialect = (process.env['DB_DIALECT'] as 'sqlite' | 'postgres' | 'mysql') ?? 'sqlite';
  const url = process.env['DB_URL'] ?? './data/app.db';
  const port = Number(process.env['PORT'] ?? 3000);
  const tenantId = process.env['TENANT_ID'] ?? 'tenant01';

  const app = await createBlogApp({
    dialect,
    url,
    tenantId,
    logger: {
      info: (msg, meta) => console.log(meta ? `${msg} ${JSON.stringify(meta)}` : msg),
      error: (msg, meta) => console.error(meta ? `${msg} ${JSON.stringify(meta)}` : msg),
    },
    // 媒体资产目录（默认 ./data/media；显式指定便于备份与迁移）
    media: process.env['MEDIA_ROOT'] ? { root: process.env['MEDIA_ROOT'] } : undefined,
    authz: { jwtSecret: process.env['JWT_SECRET'] },
    http: {
      // Management API 守卫：Bearer Token（生产必须显式配置 MANAGE_TOKEN）
      manageToken: process.env['MANAGE_TOKEN'] ?? 'dev-only-token',
      // 管理后台静态资源（make build-admin 产出 dist/admin）
      staticDir: process.env['ADMIN_STATIC_DIR'] ?? 'dist/admin',
      // RATE_LIMIT_DISABLED=1 关闭限流（本地压测/内网无代理部署时用）
      ...(process.env['RATE_LIMIT_DISABLED'] === '1' ? { rateLimit: { enabled: false } } : {}),
    },
  });

  // 自检：内核 + 模块装配是否就绪
  console.log('[selfcheck] OK', { modules: app.loadedModules(), dialect });

  // --selfcheck：只做装配自检然后退出（交付测试用）；否则进入 HTTP 常驻模式
  if (process.argv.includes('--selfcheck')) {
    await app.stop();
    return;
  }

  // 启动 HTTP 服务（@hono/node-server：Node 兼容运行时）
  // 前台页面（场景自有展示层）挂在 API/静态之前：同一份内容，两个消费方
  const root = new Hono();
  root.route(
    '/',
    createBlogFront({
      content: app.registry.require<ContentService>(Tokens.Content),
      tenantId,
      siteTitle: process.env['SITE_TITLE'] ?? '我的博客',
      cache: app.registry.get<CacheProvider>(Tokens.Cache),
    })
  );
  root.route('/', app.registry.require<Hono>(HttpTokens.App));
  const hono = root;
  const server: ServerType = serve({ fetch: hono.fetch, port }, (info) => {
    console.log(`[http] listening on http://localhost:${info.port}`);
    console.log(`[http] Content API   GET /api/v1/posts`);
    console.log(`[http] Management API POST /api/manage/v1/posts (Authorization: Bearer <token>)`);
  });

  const shutdown = async (): Promise<void> => {
    console.log('[shutdown] closing...');
    server.close();
    await app.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[fatal]', (e as Error).message);
  process.exit(1);
});
