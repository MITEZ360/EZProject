// scenarios/generic-cms/index.ts
// 场景产品：通用 CMS。只组装模块，不发明新能力，内核零改动。
// 与 blog 场景的差别：不带内建类型（类型由运行时 defineType 定义）、
// 装配全部通用管理模块（audit/settings），对应"通用 CMS"产品形态。

import { bootstrap, type App, type Logger } from '@kernel/bootstrap.js';
import { storageModule } from '@modules/storage/index.js';
import { contentModule } from '@modules/content/index.js';
import { httpModule, type HttpModuleOptions } from '@modules/http/index.js';
import { auditModule } from '@modules/audit/index.js';
import { settingsModule } from '@modules/settings/index.js';

export interface GenericCmsOptions {
  dialect?: 'sqlite' | 'postgres' | 'mysql';
  url?: string;
  logger?: Logger;
  /** 默认租户 */
  tenantId?: string;
  /** HTTP 模块配置（不传则不挂 HTTP 层） */
  http?: HttpModuleOptions;
  /** 是否装配通用管理模块（audit/settings），默认 true */
  adminModules?: boolean;
}

/** 组装通用 CMS：storage + content + http + audit + settings */
export async function createGenericCmsApp(options: GenericCmsOptions = {}): Promise<App> {
  const withAdmin = options.adminModules ?? true;
  return bootstrap({
    modules: [
      storageModule({ dialect: options.dialect, url: options.url }),
      contentModule(), // 无内建类型：通用 CMS 的类型全部运行时定义
      ...(withAdmin ? [auditModule(), settingsModule()] : []),
      ...(options.http ? [httpModule({ ...options.http, tenantId: options.tenantId })] : []),
    ],
    config: { dialect: options.dialect, url: options.url },
    logger: options.logger,
  });
}
