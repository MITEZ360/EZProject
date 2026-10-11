// modules/http/internal/guard.ts
// Management API 的鉴权守卫（策略接口）。
// 阶段一：Bearer Token 默认实现；authz 模块落地后由场景注入 AuthzService 守卫，本文件不改。

import type { Principal } from '@kernel/primitives/principal.js';

/** 守卫策略：请求 → 主体（null = 拒绝）。HTTP 语义只到这里，RBAC/Scope 属 authz 模块。 */
export type RequestGuard = (req: Request, tenantId: string) => Promise<Principal | null>;

/** Bearer Token 守卫：Authorization: Bearer <token> 与期望值恒等比较 */
export function bearerTokenGuard(expectedToken: string): RequestGuard {
  return async (req, tenantId) => {
    const header = req.headers.get('authorization') ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m || m[1] !== expectedToken) return null;
    return { id: 'api-manager', tenantId, kind: 'user' };
  };
}

/** 允许所有写请求的守卫（仅限测试/本地开发使用） */
export function allowAllGuard(): RequestGuard {
  return async (_req, tenantId) => ({ id: 'dev', tenantId, kind: 'user' });
}
