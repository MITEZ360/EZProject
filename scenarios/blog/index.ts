// scenarios/blog/index.ts
// 场景产品：博客。只组装模块，不发明新能力，内核零改动。
// 这里用最简方式展示"一个核心延伸出场景产品"。

import { bootstrap, type App, type Logger } from '@kernel/bootstrap.js';
import type { EntityTypeDef } from '@kernel/primitives/entity.js';
import { storageModule } from '@modules/storage/index.js';
import { contentModule } from '@modules/content/index.js';
import { httpModule, type HttpModuleOptions } from '@modules/http/index.js';
import { authzModule, type AuthzModuleOptions } from '@modules/authz/index.js';
import { mediaModule, type MediaModuleOptions } from '@modules/media/index.js';
import { cacheModule, type CacheModuleOptions } from '@modules/cache/index.js';
import { searchModule } from '@modules/search/index.js';
import { webhookModule } from '@modules/webhook/index.js';
import { auditModule } from '@modules/audit/index.js';
import { settingsModule } from '@modules/settings/index.js';

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
      { name: 'cover', type: 'media' }, // 封面：只存 asset id（铁律）
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
  /** 缓存模块配置（memory 默认 / none） */
  cache?: CacheModuleOptions;
  /** 媒体模块配置（local 目录） */
  media?: MediaModuleOptions;
  /** HTTP 模块配置（不传则不挂 HTTP 层） */
  http?: HttpModuleOptions;
}

/** 组装博客场景：storage + content + http（+ 未来 authz/search）。 */
export async function createBlogApp(options: BlogOptions = {}): Promise<App> {
  return bootstrap({
    modules: [
      storageModule({ dialect: options.dialect, url: options.url }),
      cacheModule(options.cache), // 内容读缓存（memory/none）
      authzModule(options.authz),
      contentModule(blogTypes),
      mediaModule(options.media), // 媒体资产（local 策略）
      searchModule(), // 全文检索（按方言选策略：SQLite=FTS5 / PG=tsvector；索引随内容事件增量更新）
      auditModule(), // 审计日志（通用管理）
      settingsModule(), // 系统设置（通用管理）
      webhookModule(), // 内容事件外部通知（目标：WEBHOOK_URL 或租户设置 webhook.url）
      ...(options.http ? [httpModule({ ...options.http, tenantId: options.tenantId })] : []),
    ],
    config: { dialect: options.dialect, url: options.url },
    logger: options.logger,
  });
}
