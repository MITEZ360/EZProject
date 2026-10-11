// scenarios/generic-cms/main.ts
// 可运行入口：启动通用 CMS（自包含交付物的入口）。
// 默认 SQLite、零配置；环境变量可覆盖。Node 兼容（@hono/node-server）。

import { serve, type ServerType } from '@hono/node-server';
import type { Hono } from 'hono';
import { createGenericCmsApp } from './index.js';
import { HttpTokens } from '@modules/http/index.js';

async function main(): Promise<void> {
  const dialect = (process.env['DB_DIALECT'] as 'sqlite' | 'postgres' | 'mysql') ?? 'sqlite';
  const url = process.env['DB_URL'] ?? './data/app.db';
  const port = Number(process.env['PORT'] ?? 3000);
  const tenantId = process.env['TENANT_ID'] ?? 'tenant01';

  const app = await createGenericCmsApp({
    dialect,
    url,
    tenantId,
    logger: {
      info: (msg, meta) => console.log(meta ? `${msg} ${JSON.stringify(meta)}` : msg),
      error: (msg, meta) => console.error(meta ? `${msg} ${JSON.stringify(meta)}` : msg),
    },
    authz: { jwtSecret: process.env['JWT_SECRET'] },
    http: {
      manageToken: process.env['MANAGE_TOKEN'] ?? 'dev-only-token',
      staticDir: process.env['ADMIN_STATIC_DIR'] ?? 'dist/admin',
    },
  });

  console.log('[selfcheck] OK', { modules: app.loadedModules(), dialect });
  if (process.argv.includes('--selfcheck')) {
    await app.stop();
    return;
  }

  const hono = app.registry.require<Hono>(HttpTokens.App);
  const server: ServerType = serve({ fetch: hono.fetch, port }, (info) => {
    console.log(`[http] listening on http://localhost:${info.port}`);
    console.log(`[http] 管理后台   GET  /admin`);
    console.log(`[http] Content API GET /api/v1/:type`);
    console.log(`[http] 类型定义    POST /api/manage/v1/types`);
  });

  const shutdown = async (): Promise<void> => {
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
