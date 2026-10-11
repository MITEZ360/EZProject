// modules/http/index.ts
// HTTP 模块入口：实现 PlatformModule。
// 职责：依赖 content 服务（经注册表按契约取用）→ 构建 Hono 应用 → 注册 'http.app' 能力。
// 内核零依赖本模块；场景经本模块导出的工厂组装（场景 → 模块方向的依赖合法）。

import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import { Tokens } from '@kernel/registry.js';
import { buildApp, type HttpApp } from './internal/app.js';
import { bearerTokenGuard, allowAllGuard, type RequestGuard } from './internal/guard.js';

export type { HttpApp };

/** 本模块注册进 registry 的能力 token（模块自有，非内核 Tokens） */
export const HttpTokens = {
  App: 'http.app',
} as const;

export interface HttpModuleOptions {
  /** Management API 鉴权守卫（策略）。默认 Bearer Token（token 取 config.manageToken 或环境变量） */
  guard?: RequestGuard;
  /** 默认租户 id（场景注入） */
  tenantId?: string;
  /** Bearer Token 守卫的期望值（未传 guard 时生效） */
  manageToken?: string;
  /** 管理后台静态资源目录（如 'dist/admin'；不传则不托管） */
  staticDir?: string;
}

export function httpModule(options: HttpModuleOptions = {}): PlatformModule {
  return {
    name: 'http',
    dependsOn: ['content'], // 只依赖名字（宪法三），经注册表按契约取用

    async setup({ registry, config }): Promise<void> {
      const content = registry.require<ContentService>(Tokens.Content);
      const tenantId =
        options.tenantId ?? (config['tenantId'] as string | undefined) ?? 'default';
      const guard =
        options.guard ??
        bearerTokenGuard(
          options.manageToken ??
            (config['manageToken'] as string | undefined) ??
            process.env['MANAGE_TOKEN'] ??
            ''
        );
      const staticDir =
        options.staticDir ?? (config['staticDir'] as string | undefined) ?? process.env['ADMIN_STATIC_DIR'];
      const app = buildApp({ content, guard, tenantId, staticDir });
      registry.provide<HttpApp>(HttpTokens.App, app);
    },
  };
}

export { bearerTokenGuard, allowAllGuard };
export type { RequestGuard };
