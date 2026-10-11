// modules/http/index.ts
// HTTP 模块入口：实现 PlatformModule。
// 职责：依赖 content 服务（经注册表按契约取用）→ 构建 Hono 应用 → 注册 'http.app' 能力。
// 内核零依赖本模块；场景经本模块导出的工厂组装（场景 → 模块方向的依赖合法）。

import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import { Tokens } from '@kernel/registry.js';
import { buildApp, type HttpApp } from './internal/app.js';
import { bearerTokenGuard, allowAllGuard, type RequestGuard } from './internal/guard.js';
import { createMemoryRateLimit, type RateLimitPolicy } from './internal/rate-limit.js';

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
  /**
   * 限流。**默认开启**（60s 窗口，按 IP：Content API 120 次 / 登录 10 次）。
   * `{ enabled: false }` 关闭；也可注入自定义策略（如多实例共享的外置限流）。
   */
  rateLimit?: {
    enabled?: boolean;
    /** 窗口长度（秒），默认 60 */
    windowSeconds?: number;
    /** 桶上限（防限流器自身被 key 泛滥打爆），默认 10000 */
    maxKeys?: number;
    /** Content API 每窗口每 IP 额度，默认 120 */
    apiMax?: number;
    /** 登录端点每窗口每 IP 额度（防爆破），默认 10 */
    loginMax?: number;
    /** 自定义限流策略（不传则用进程内固定窗口） */
    policy?: RateLimitPolicy;
  };
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
      // 通用管理端点惰性解析：audit/settings 由各模块自行注册（加载顺序无关）
      const manageToken =
        options.manageToken ?? (config['manageToken'] as string | undefined) ?? process.env['MANAGE_TOKEN'];

      const rl = options.rateLimit;
      const rateLimit =
        rl?.enabled === false
          ? undefined
          : {
              policy:
                rl?.policy ??
                createMemoryRateLimit({ windowSeconds: rl?.windowSeconds, maxKeys: rl?.maxKeys }),
              apiMax: rl?.apiMax ?? 120,
              loginMax: rl?.loginMax ?? 10,
            };

      const app = buildApp({ content, guard, tenantId, staticDir, registry, manageToken, rateLimit });
      registry.provide<HttpApp>(HttpTokens.App, app);
    },
  };
}

export { bearerTokenGuard, allowAllGuard };
export type { RequestGuard };
