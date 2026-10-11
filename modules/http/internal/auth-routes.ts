// modules/http/internal/auth-routes.ts
// 认证与管理路由（模块贡献端点的懒解析形态）：
//   POST /auth/login      邮箱+密码 → JWT 访问令牌 + 刷新令牌
//   POST /auth/refresh    刷新令牌轮换
//   POST /auth/logout     撤销刷新令牌
//   POST /auth/bootstrap  引导（需引导令牌）建首个管理员
//   GET  /auth/me         当前主体
//   /users /roles         用户与角色管理（需 authz 授权）

import type { Context, Hono } from 'hono';
import type { IdentityService, Role } from '@kernel/contracts/identity.contract.js';
import type { AuthzService } from '@kernel/contracts/authz.contract.js';
import type { Principal } from '@kernel/primitives/principal.js';
import type { Registry } from '@kernel/registry.js';
import { statusOf, errorBody } from './errors.js';

type Vars = { Variables: { principal: Principal; tenantId: string } };

export interface AuthRouteDeps {
  registry: Registry;
  defaultTenantId: string;
}

const identityOf = (deps: AuthRouteDeps): IdentityService | undefined =>
  deps.registry.get<IdentityService>('identity');
const authzOf = (deps: AuthRouteDeps): AuthzService | undefined =>
  deps.registry.get<AuthzService>('authz');

const missing = (c: { json: (b: unknown, s?: number) => Response }): Response =>
  c.json({ error: { code: 'E_NOT_FOUND', message: '身份模块未挂载（未加载 authzModule）' } }, 404);

export function mountAuthRoutes(manage: Hono<Vars>, deps: AuthRouteDeps): void {
  // ---------- 公开：登录 / 刷新 / 登出 ----------

  manage.post('/auth/login', async (c) => {
    const identity = identityOf(deps);
    if (!identity) return missing(c);
    const body = await c.req.json().catch(() => null);
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b['email'] !== 'string' || typeof b['password'] !== 'string') {
      return c.json({ error: { code: 'E_VALIDATION', message: '需要 email 与 password' } }, 400);
    }
    const tenantId = typeof b['tenantId'] === 'string' ? b['tenantId'] : deps.defaultTenantId;
    const pair = await identity.login(tenantId, b['email'], b['password']);
    // 统一失败文案：不区分"用户不存在/密码错误"
    if (!pair) return c.json({ error: { code: 'E_UNAUTHORIZED', message: '邮箱或密码错误' } }, 401);
    return c.json(pair);
  });

  manage.post('/auth/refresh', async (c) => {
    const identity = identityOf(deps);
    if (!identity) return missing(c);
    const body = await c.req.json().catch(() => null);
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b['refreshToken'] !== 'string') {
      return c.json({ error: { code: 'E_VALIDATION', message: '需要 refreshToken' } }, 400);
    }
    const tenantId = typeof b['tenantId'] === 'string' ? b['tenantId'] : deps.defaultTenantId;
    const pair = await identity.refresh(tenantId, b['refreshToken']);
    if (!pair) return c.json({ error: { code: 'E_UNAUTHORIZED', message: '刷新令牌无效或已撤销' } }, 401);
    return c.json(pair);
  });

  manage.post('/auth/logout', async (c) => {
    const identity = identityOf(deps);
    if (!identity) return missing(c);
    const body = await c.req.json().catch(() => null);
    const token = ((body ?? {}) as Record<string, unknown>)['refreshToken'];
    if (typeof token === 'string') await identity.logout(token);
    return c.json({ ok: true });
  });

  // ---------- 需守卫：引导 / me / 用户 / 角色 ----------

  // 引导：用 MANAGE_TOKEN（kind=bootstrap）创建首个管理员
  manage.post('/auth/bootstrap', async (c) => {
    const identity = identityOf(deps);
    if (!identity) return missing(c);
    const principal = c.get('principal');
    if (principal.kind !== 'bootstrap') {
      return c.json({ error: { code: 'E_FORBIDDEN', message: '仅引导令牌可执行引导' } }, 403);
    }
    const body = await c.req.json().catch(() => null);
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b['email'] !== 'string' || typeof b['password'] !== 'string') {
      return c.json({ error: { code: 'E_VALIDATION', message: '需要 email 与 password' } }, 400);
    }
    const tenantId = typeof b['tenantId'] === 'string' ? b['tenantId'] : c.get('tenantId');
    try {
      const adminRole: Omit<Role, 'id' | 'createdAt' | 'updatedAt'> = {
        tenantId,
        slug: 'admin',
        name: '管理员',
        permissions: [{ resource: '*', actions: ['*'] }],
        builtin: true,
      };
      await identity.upsertRole(adminRole);
      const user = await identity.createUser({
        tenantId,
        email: b['email'],
        name: typeof b['name'] === 'string' ? b['name'] : '管理员',
        password: b['password'],
        roles: ['admin'],
      });
      return c.json({ ok: true, user }, 201);
    } catch (e) {
      return c.json(errorBody(e), statusOf(e));
    }
  });

  manage.get('/auth/me', (c) => {
    const principal = c.get('principal');
    return c.json({ principal });
  });

  /** 管理类端点统一授权：resource 'authz' 的 read/update */
  const requireAuthz = async (
    c: Context<Vars>,
    action: 'read' | 'update'
  ): Promise<Response | null> => {
    const authz = authzOf(deps);
    if (!authz) return missing(c);
    const decision = await authz.can(c.get('principal'), { resource: 'authz', action });
    if (!decision.allowed) {
      return c.json({ error: { code: decision.reason ?? 'E_FORBIDDEN', message: '权限不足' } }, 403);
    }
    return null;
  };

  // ---------- 用户 ----------
  manage.get('/users', async (c) => {
    const denied = await requireAuthz(c, 'read');
    if (denied) return denied;
    const identity = identityOf(deps)!;
    return c.json({ items: await identity.listUsers(c.get('tenantId')) });
  });

  manage.post('/users', async (c) => {
    const denied = await requireAuthz(c, 'update');
    if (denied) return denied;
    const identity = identityOf(deps)!;
    const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (typeof b['email'] !== 'string' || typeof b['password'] !== 'string') {
      return c.json({ error: { code: 'E_VALIDATION', message: '需要 email 与 password' } }, 400);
    }
    try {
      const user = await identity.createUser({
        tenantId: c.get('tenantId'),
        email: b['email'],
        name: typeof b['name'] === 'string' ? b['name'] : b['email'],
        password: b['password'],
        roles: Array.isArray(b['roles']) ? (b['roles'] as string[]) : [],
      });
      return c.json(user, 201);
    } catch (e) {
      return c.json(errorBody(e), statusOf(e));
    }
  });

  manage.put('/users/:id', async (c) => {
    const denied = await requireAuthz(c, 'update');
    if (denied) return denied;
    const identity = identityOf(deps)!;
    const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    try {
      const patch: { name?: string; roles?: string[]; status?: string } = {};
      if (typeof b['name'] === 'string') patch.name = b['name'];
      if (Array.isArray(b['roles'])) patch.roles = b['roles'] as string[];
      if (typeof b['status'] === 'string') patch.status = b['status'];
      return c.json(await identity.updateUser(c.req.param('id'), c.get('tenantId'), patch));
    } catch (e) {
      return c.json(errorBody(e), statusOf(e));
    }
  });

  manage.post('/users/:id/password', async (c) => {
    const denied = await requireAuthz(c, 'update');
    if (denied) return denied;
    const identity = identityOf(deps)!;
    const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (typeof b['password'] !== 'string' || b['password'].length < 8) {
      return c.json({ error: { code: 'E_VALIDATION', message: '密码至少 8 位' } }, 400);
    }
    try {
      await identity.setPassword(c.req.param('id'), c.get('tenantId'), b['password']);
      return c.json({ ok: true });
    } catch (e) {
      return c.json(errorBody(e), statusOf(e));
    }
  });

  // ---------- 角色 ----------
  manage.get('/roles', async (c) => {
    const denied = await requireAuthz(c, 'read');
    if (denied) return denied;
    return c.json({ items: await identityOf(deps)!.listRoles(c.get('tenantId')) });
  });

  manage.post('/roles', async (c) => {
    const denied = await requireAuthz(c, 'update');
    if (denied) return denied;
    const identity = identityOf(deps)!;
    const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (typeof b['slug'] !== 'string' || !Array.isArray(b['permissions'])) {
      return c.json({ error: { code: 'E_VALIDATION', message: '需要 slug 与 permissions' } }, 400);
    }
    try {
      const role = await identity.upsertRole({
        tenantId: c.get('tenantId'),
        slug: b['slug'],
        name: typeof b['name'] === 'string' ? b['name'] : b['slug'],
        permissions: b['permissions'] as Role['permissions'],
      });
      return c.json(role, 201);
    } catch (e) {
      return c.json(errorBody(e), statusOf(e));
    }
  });

  manage.delete('/roles/:slug', async (c) => {
    const denied = await requireAuthz(c, 'update');
    if (denied) return denied;
    try {
      await identityOf(deps)!.deleteRole(c.req.param('slug'), c.get('tenantId'));
      return c.json({ ok: true });
    } catch (e) {
      return c.json(errorBody(e), statusOf(e));
    }
  });
}
