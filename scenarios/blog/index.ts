// scenarios/blog/index.ts
// 场景产品：博客。只组装模块，不发明新能力，内核零改动。
// 这里用最简方式展示"一个核心延伸出场景产品"。

import { bootstrap, type App, type Logger } from '@kernel/bootstrap.js';
import type { EntityTypeDef } from '@kernel/primitives/entity.js';
import { storageModule } from '@modules/storage/index.js';
import { contentModule } from '@modules/content/index.js';

/** 博客的内容类型定义（数据驱动，非内核代码） */
export const blogTypes: EntityTypeDef[] = [
  {
    slug: 'posts',
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true },
      { name: 'body', type: 'richText', required: true },
      { name: 'featured', type: 'boolean' },
    ],
    versioned: true,
    locales: ['zh', 'en'],
    tenantScoped: true,
  },
];

export interface BlogOptions {
  dialect?: 'sqlite' | 'postgres' | 'mysql';
  url?: string;
  logger?: Logger;
}

/** 组装博客场景：storage + content（+ 未来 authz/search）。 */
export async function createBlogApp(options: BlogOptions = {}): Promise<App> {
  return bootstrap({
    modules: [
      storageModule({ dialect: options.dialect, url: options.url }),
      contentModule(blogTypes),
    ],
    config: { dialect: options.dialect, url: options.url },
    logger: options.logger,
  });
}
