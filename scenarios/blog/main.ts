// scenarios/blog/main.ts
// 可运行入口：启动博客场景（自包含交付物的入口）。
// 默认 SQLite、零配置；可用环境变量切库（切库需已实现对应驱动）。
//
// 注意：环境变量读取用 process.env（兼容 Node），不使用 Bun.env。

import { createBlogApp } from './index.js';

async function main(): Promise<void> {
  const dialect = (process.env['DB_DIALECT'] as 'sqlite' | 'postgres' | 'mysql') ?? 'sqlite';
  const url = process.env['DB_URL'] ?? './data/app.db';

  const app = await createBlogApp({
    dialect,
    url,
    logger: {
      info: (msg, meta) => console.log(meta ? `${msg} ${JSON.stringify(meta)}` : msg),
      error: (msg, meta) => console.error(meta ? `${msg} ${JSON.stringify(meta)}` : msg),
    },
  });

  // 自检：内核 + 模块装配是否就绪
  console.log('[selfcheck] OK', { modules: app.loadedModules(), dialect });

  const shutdown = async (): Promise<void> => {
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
