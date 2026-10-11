// modules/http/internal/app.ts
// Hono 应用构建：Content API（只读/匿名/可缓存）+ Management API（写/守卫）+ 通用管理端点。
// 只依赖内核契约（经注册表注入），不 import 其他模块实现。
// 通用管理端点（audit/settings）**惰性解析**：路由恒挂载，请求时从注册表解析能力——
// 模块加载顺序无关；模块未加载时返回 404 JSON。

import { Hono, type Context } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { AuditService } from '@kernel/contracts/audit.contract.js';
import type { SettingsService } from '@kernel/contracts/settings.contract.js';
import type { IdentityService } from '@kernel/contracts/identity.contract.js';
import type { AuthzService } from '@kernel/contracts/authz.contract.js';
import { mountAuthRoutes } from './auth-routes.js';
import type { Principal } from '@kernel/primitives/principal.js';
import type { Registry } from '@kernel/registry.js';
import { statusOf, errorBody } from './errors.js';
import { parseFilters } from './filters.js';
import type { RequestGuard } from './guard.js';

/** Hono 上下文变量类型（中间件与路由间传递的主体/租户） */
type Vars = {
  Variables: { principal: Principal; tenantId: string };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Content API 顶层物理列白名单：其余字段名自动视为内容字段（data.*） */
const TOP_LEVEL_FIELDS: ReadonlySet<string> = new Set([
  'id', 'type', 'slug', 'status', 'locale', 'tenantId', 'createdAt', 'updatedAt',
]);

/** HTTP 模块对外暴露的应用类型（场景/测试经 registry 取用） */
export type HttpApp = Hono<Vars>;

export interface HttpDeps {
  content: ContentService;
  guard: RequestGuard;
  /** 默认租户（场景注入；单租户场景的便捷） */
  tenantId: string;
  /** 注册表（惰性解析可选能力：audit/settings/identity/authz） */
  registry: Registry;
  /** 引导令牌（MANAGE_TOKEN）：仅在 authz 模块未挂载时作为唯一凭证 */
  manageToken?: string;
  /** 管理后台静态资源目录（相对 cwd，如 'dist/admin'）；不传则不托管 */
  staticDir?: string;
}

const notFound = (c: { json: (b: unknown, s?: number) => unknown }): Response =>
  c.json({ error: { code: 'E_NOT_FOUND', message: '能力未挂载（模块未加载）' } }, 404) as Response;

export function buildApp(deps: HttpDeps): Hono<Vars> {
  const app = new Hono<Vars>();

  // ---------- Content API（对外 · 只读 · 匿名 · 可缓存） ----------
  const contentApi = new Hono<Vars>();

  // GET /api/v1/:type —— 列表（分页 + 过滤；默认只出 published）
  // 自定义字段查询：?filter[price][gte]=100&filter[tags][contains]=hot（决策 #26）
  contentApi.get('/:type', async (c) => {
    const type = c.req.param('type');
    const q = c.req.query();
    const status = q['status'] ?? 'published';
    const { filters, errors } = parseFilters(q, TOP_LEVEL_FIELDS);
    if (errors.length > 0) {
      return c.json({ error: { code: 'E_VALIDATION', message: errors.join('；') } }, 400);
    }
    const page = await deps.content.find({
      type,
      tenantId: q['tenant'] ?? deps.tenantId,
      locale: q['locale'],
      status: status === 'all' ? undefined : status,
      filters: filters.length > 0 ? filters : undefined,
      limit: q['limit'] ? Math.min(Number(q['limit']), 100) : 20,
      offset: q['offset'] ? Number(q['offset']) : 0,
    });
    c.header('Cache-Control', 'public, max-age=60'); // 对外只读，可进 CDN
    return c.json({ items: page.items, total: page.total });
  });

  // GET /api/v1/:type/:key —— key 为 UUID 时按 id，否则按 slug
  contentApi.get('/:type/:key', async (c) => {
    const type = c.req.param('type');
    const key = c.req.param('key');
    const tenantId = c.req.query('tenant') ?? deps.tenantId;
    const status = c.req.query('status') ?? 'published';

    let entity: Record<string, unknown> | null = null;
    if (UUID_RE.test(key)) {
      const found = await deps.content.findOne(key, tenantId);
      if (found && found.type === type) entity = found as unknown as Record<string, unknown>;
    } else {
      const page = await deps.content.find({ type, tenantId, status, filter: { slug: key }, limit: 1 });
      entity = (page.items[0] as unknown as Record<string, unknown>) ?? null;
    }
    if (!entity) return c.json({ error: { code: 'E_NOT_FOUND', message: '条目不存在' } }, 404);
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(entity);
  });

  // ---------- Management API（对内 · 写 · 守卫） ----------
  const manage = new Hono<Vars>();

  // 公开路径（无需凭证）：登录 / 刷新 / 登出
  const PUBLIC_PATHS = new Set([
    '/api/manage/v1/auth/login',
    '/api/manage/v1/auth/refresh',
    '/api/manage/v1/auth/logout',
  ]);

  // 守卫中间件：JWT（authz 模块在场时）→ 引导令牌兜底 → 场景自定义守卫
  manage.use('*', async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next(); // 公开端点
    const tenantId = c.req.header('x-tenant-id') ?? deps.tenantId;
    let principal: Principal | null = null;

    const header = c.req.header('authorization') ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    const token = m?.[1];
    if (token) {
      const identity = deps.registry.get<IdentityService>('identity');
      if (identity) {
        principal = await identity.verifyAccessToken(token);
        if (!principal) {
          // authz 在场时，引导令牌仍可作为 bootstrap 主体（用于 /auth/bootstrap）
          principal =
            deps.manageToken && token === deps.manageToken
              ? { id: 'bootstrap', tenantId, kind: 'bootstrap' }
              : null;
        }
      } else if (deps.manageToken && token === deps.manageToken) {
        principal = { id: 'bootstrap', tenantId, kind: 'bootstrap' };
      }
    }
    if (!principal) {
      principal = await deps.guard(c.req.raw, tenantId); // 场景自定义守卫（允许全开等）
    }
    if (!principal) {
      return c.json({ error: { code: 'E_UNAUTHORIZED', message: '鉴权失败' } }, 401);
    }
    c.set('principal', principal);
    c.set('tenantId', principal.tenantId || tenantId);
    await next();
  });

  // 注意：所有固定路径路由（auth/users/roles/types/audit-logs/settings）必须注册在 /:type 通配之前
  mountAuthRoutes(manage, { registry: deps.registry, defaultTenantId: deps.tenantId });

  // GET /api/manage/v1/audit-logs（audit 模块贡献；未加载 → 404 JSON）
  manage.get('/audit-logs', async (c) => {
    const audit = deps.registry.get<AuditService>('audit');
    if (!audit) return notFound(c);
    const tenantId = c.get('tenantId') as string;
    const items = await audit.list({
      tenantId,
      event: c.req.query('event'),
      limit: c.req.query('limit') ? Math.min(Number(c.req.query('limit')), 500) : 100,
    });
    return c.json({ items });
  });

  // GET /api/manage/v1/settings（settings 模块贡献）
  manage.get('/settings', async (c) => {
    const settings = deps.registry.get<SettingsService>('settings');
    if (!settings) return notFound(c);
    return c.json({ items: await settings.list(c.get('tenantId') as string) });
  });

  // PUT /api/manage/v1/settings/:key
  manage.put('/settings/:key', async (c) => {
    const settings = deps.registry.get<SettingsService>('settings');
    if (!settings) return notFound(c);
    const tenantId = c.get('tenantId') as string;
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object' || !('value' in (body as object))) {
      return c.json({ error: { code: 'E_VALIDATION', message: '请求体需为 {"value": ...}' } }, 400);
    }
    try {
      await settings.set(tenantId, key, (body as { value: unknown }).value);
      return c.json({ ok: true });
    } catch (e) {
      return c.json(errorBody(e), statusOf(e) === 500 ? 400 : statusOf(e));
    }
  });

  // ---------- 类型管理（决策 #26：类型定义是数据） ----------

  // GET /api/manage/v1/types —— 类型定义列表
  manage.get('/types', async (c) => {
    return c.json({ items: await deps.content.listTypes(c.get('tenantId') as string) });
  });

  // POST /api/manage/v1/types —— 定义/更新内容类型（逻辑 Schema，不迁移旧数据）
  manage.post('/types', async (c) => {
    const principal = c.get('principal') as Principal;
    const tenantId = c.get('tenantId') as string;
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: { code: 'E_VALIDATION', message: '请求体必须是 JSON 对象' } }, 400);
    }
    const auth = await authorize(c, 'types', 'create');
    if ('denied' in auth) return auth.denied;
    try {
      await deps.content.defineType(body as Parameters<typeof deps.content.defineType>[0], {
        ...principal,
        tenantId, // 类型定义落当前操作租户名下
      });
      return c.json({ ok: true }, 201);
    } catch (e) {
      return c.json(errorBody(e), statusOf(e));
    }
  });

  // POST /api/manage/v1/:type —— 创建
  manage.post('/:type', async (c) => {
    const principal = c.get('principal') as Principal;
    const tenantId = c.get('tenantId') as string;
    const type = c.req.param('type');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: { code: 'E_VALIDATION', message: '请求体必须是 JSON 对象' } }, 400);
    }
    const { locale, ...data } = body as Record<string, unknown>;
    const auth = await authorize(c, type, 'create', data);
    if ('denied' in auth) return auth.denied;
    try {
      const entity = await deps.content.create({
        type,
        tenantId,
        locale: typeof locale === 'string' ? locale : undefined,
        data: auth.clean ?? data,
        actor: principal,
      });
      return c.json(entity, 201);
    } catch (e) {
      return c.json(errorBody(e), statusOf(e));
    }
  });

  // PUT /api/manage/v1/:type/:id —— 更新
  manage.put('/:type/:id', async (c) => {
    const principal = c.get('principal') as Principal;
    const tenantId = c.get('tenantId') as string;
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: { code: 'E_VALIDATION', message: '请求体必须是 JSON 对象' } }, 400);
    }
    // locale 属实体列而非 data 字段：从请求体剥离，其余全部并入 data
    const data = { ...(body as Record<string, unknown>) };
    delete data['locale'];
    const auth = await authorize(c, c.req.param('type'), 'update', data);
    if ('denied' in auth) return auth.denied;
    try {
      const entity = await deps.content.update(id, { tenantId, data: auth.clean ?? data, actor: principal });
      return c.json(entity);
    } catch (e) {
      return c.json(errorBody(e), statusOf(e));
    }
  });

  // DELETE /api/manage/v1/:type/:id —— 软删除
  manage.delete('/:type/:id', async (c) => {
    const principal = c.get('principal') as Principal;
    const auth = await authorize(c, c.req.param('type'), 'delete');
    if ('denied' in auth) return auth.denied;
    try {
      await deps.content.remove(c.req.param('id'), c.get('tenantId') as string, principal);
      return c.json({ ok: true });
    } catch (e) {
      return c.json(errorBody(e), statusOf(e));
    }
  });

  /** 写操作鉴权（authz 模块在场时强制；不在场则放行——单机/开发形态）。
   *  返回 null = 通过；返回 Response = 拒绝。同时按 scope 剥离 deniedFields。 */
  const authorize = async (
    c: Context<Vars>,
    resource: string,
    action: 'create' | 'update' | 'delete',
    data?: Record<string, unknown>
  ): Promise<{ denied: Response } | { clean: Record<string, unknown> | undefined }> => {
    const authz = deps.registry.get<AuthzService>('authz');
    if (!authz) return { clean: data };
    const decision = await authz.can(c.get('principal'), { resource, action });
    if (!decision.allowed) {
      return {
        denied: c.json(
          { error: { code: decision.reason ?? 'E_FORBIDDEN', message: '权限不足' } },
          403
        ),
      };
    }
    let clean = data;
    const deniedFields = decision.deniedFields ?? [];
    if (clean && deniedFields.length > 0) {
      clean = { ...clean };
      for (const f of deniedFields) delete clean[f]; // scope：字段级拒绝
    }
    return { clean };
  };

  app.route('/api/v1', contentApi);
  app.route('/api/manage/v1', manage);

  // 健康检查（交付测试/编排探测用）
  app.get('/healthz', (c) => c.json({ ok: true }));

  // 管理后台静态资源（自包含交付的一部分；挂在最后，API 优先）
  if (deps.staticDir) {
    const root = deps.staticDir.replace(/\/$/, '');
    app.use('*', async (c, next) => {
      // 未被任何 API 路由匹配的请求到此：API 路径必须回 404 JSON，不能被 SPA 兜底吞掉
      if (c.req.path.startsWith('/api/') || c.req.path === '/healthz') {
        return c.json({ error: { code: 'E_NOT_FOUND', message: 'Not found' } }, 404);
      }
      await next();
    });
    app.use(
      '*',
      serveStatic({ root, rewriteRequestPath: (p) => p.replace(/^\/admin/, '') }),
      serveStatic({ root, rewriteRequestPath: () => '/index.html' }) // SPA 兜底 → index.html
    );
  }

  return app;
}
