// scenarios/blog/index.ts
// 场景产品：博客。只组装模块，不发明新能力，内核零改动。
// 这里用最简方式展示"一个核心延伸出场景产品"。

import { bootstrap, type App, type Logger } from '@kernel/bootstrap.js';
import type { EntityTypeDef } from '@kernel/primitives/entity.js';
import { storageModule } from '@modules/storage/index.js';
import { contentModule } from '@modules/content/index.js';
import { httpModule, type HttpModuleOptions } from '@modules/http/index.js';
import { authzModule, type AuthzModuleOptions } from '@modules/authz/index.js';

/** 博客的内容类型定义（数据驱动，非内核代码） */
export const blogTypes: EntityTypeDef[] = [
  {
    slug: 'posts',
    fields: [
      // 注意：slug/status 是保留键（顶层物理列），不是 data 字段——
      // 从 data.slug 提升至列由 content 服务负责，需要强唯一性的值走这条通道
      { name: 'title', type: 'text', required: true },
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
  /** 默认租户（博客场景单租户起步） */
  tenantId?: string;
  /** 身份与权限模块配置（JWT 密钥等）；不传则用默认（开发随机密钥） */
  authz?: AuthzModuleOptions;
  /** HTTP 模块配置（不传则不挂 HTTP 层） */
  http?: HttpModuleOptions;
}

/** 组装博客场景：storage + content + http（+ 未来 authz/search）。 */
export async function createBlogApp(options: BlogOptions = {}): Promise<App> {
  return bootstrap({
    modules: [
      storageModule({ dialect: options.dialect, url: options.url }),
      authzModule(options.authz),
      contentModule(blogTypes),
      ...(options.http ? [httpModule({ ...options.http, tenantId: options.tenantId })] : []),
    ],
    config: { dialect: options.dialect, url: options.url },
    logger: options.logger,
  });
}
