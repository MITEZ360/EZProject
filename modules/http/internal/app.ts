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
import type { AssetStore } from '@kernel/contracts/asset.contract.js';
import type { CacheProvider } from '@kernel/contracts/cache.contract.js';
import type { SearchProvider } from '@kernel/contracts/search.contract.js';
import { newId } from '@kernel/primitives/id.js';
import { mountAuthRoutes } from './auth-routes.js';
import type { Principal } from '@kernel/primitives/principal.js';
import type { Registry } from '@kernel/registry.js';
import { statusOf, errorBody } from './errors.js';
import { parseFilters } from './filters.js';
import { clientIp, type RateLimitPolicy } from './rate-limit.js';
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
  /**
   * 限流（不传则不限流）。只作用于匿名可及的高风险入口：
   * `/api/v1/*`（对外只读、易被爬）与登录端点（防爆破）。
   */
  rateLimit?: {
    policy: RateLimitPolicy;
    /** Content API：每窗口每 IP 额度 */
    apiMax: number;
    /** 登录端点：每窗口每 IP 额度 */
    loginMax: number;
  };
}

const notFound = (c: { json: (b: unknown, s?: number) => unknown }): Response =>
  c.json({ error: { code: 'E_NOT_FOUND', message: '能力未挂载（模块未加载）' } }, 404) as Response;

/** 解析 `?fields=a,b`；返回 null 表示不裁剪（未指定或全为空白） */
function parseFields(q: Record<string, string | undefined>): string[] | null {
  const raw = q['fields'];
  if (!raw) return null;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

/**
 * 按 `?fields` 裁剪条目的 `data`。
 * **只裁 `data`**：顶层列（id/type/slug/locale/status/时间）是结构信息，
 * 裁掉会让人无法定位条目、也无法判断可见性；未知字段名直接忽略（不报错、不凭空造键）。
 */
function projectFields<T extends Record<string, unknown>>(entry: T, fields: string[] | null): T {
  if (!fields) return entry;
  const data = entry['data'];
  if (!data || typeof data !== 'object') return entry;
  const src = data as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(src, f)) picked[f] = src[f];
  }
  return { ...entry, data: picked };
}

export function buildApp(deps: HttpDeps): Hono<Vars> {
  const app = new Hono<Vars>();

  // ---------- 限流（最先执行：挡在鉴权与业务之前） ----------
  // 只对匿名可及的高风险入口生效；静态资源与 /healthz 不限，避免拖慢页面加载。
  const rl = deps.rateLimit;
  if (rl) {
    app.use('*', async (c, next) => {
      const path = c.req.path;
      const isLogin = path === '/api/manage/v1/auth/login';
      const isPublicApi = path === '/api/v1' || path.startsWith('/api/v1/');
      if (!isLogin && !isPublicApi) return next();

      const ip = clientIp(c.req.raw.headers);
      const verdict = isLogin
        ? rl.policy.check(`login:${ip}`, rl.loginMax)
        : rl.policy.check(`api:${ip}`, rl.apiMax);

      if (!verdict.allowed) {
        c.header('retry-after', String(verdict.retryAfterSeconds));
        return c.json(
          {
            error: {
              code: 'E_RATE_LIMITED',
              message: `请求过于频繁，请 ${verdict.retryAfterSeconds} 秒后重试`,
            },
          },
          429
        );
      }
      await next();
    });
  }

  // ---------- Content API（对外 · 只读 · 匿名 · 可缓存） ----------
  const contentApi = new Hono<Vars>();

  const cacheOf = (): CacheProvider | undefined => deps.registry.get<CacheProvider>('cache');
  const assetsOf = (): AssetStore | undefined => deps.registry.get<AssetStore>('assets');

  /** 读路径缓存：命中即返回；未命中查询后写回（TTL 60s）。key 前缀与写失效一致 */
  const withCache = async (
    tenantId: string,
    key: string,
    produce: () => Promise<unknown>
  ): Promise<{ value: unknown; hit: boolean }> => {
    const cache = cacheOf();
    if (!cache) return { value: await produce(), hit: false };
    const ck = `content:${tenantId}:${key}`;
    const hit = await cache.get(ck);
    if (hit !== null) return { value: hit, hit: true };
    const value = await produce();
    await cache.set(ck, value, 60);
    return { value, hit: false };
  };

  /**
   * 预览门（Content API 的读权限）：
   * 公开只读**仅限 published**；非 published（草稿）与 `status=all` 必须带有效凭证。
   * 凭证 = JWT 访问令牌（authz 模块在场时）或引导令牌（单机/调试形态）。
   *
   * 安全约束（两条都不能省）：
   *  1. 预览响应一律 `private, no-store`；
   *  2. 预览读取**绕过共享缓存**（不读不写）——否则草稿会经缓存泄漏给匿名请求。
   */
  const previewPrincipal = async (c: Context<Vars>): Promise<Principal | null> => {
    const m = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '');
    const token = m?.[1];
    if (!token) return null;
    const identity = deps.registry.get<IdentityService>('identity');
    if (identity) {
      const p = await identity.verifyAccessToken(token);
      if (p) return p;
    }
    if (deps.manageToken && token === deps.manageToken) {
      return { id: 'bootstrap', tenantId: deps.tenantId, kind: 'bootstrap' };
    }
    return null;
  };

  // GET /api/v1/assets/:id —— 资产下载/回源（公开读；长缓存）
  contentApi.get('/assets/:id', async (c) => {
    const assets = assetsOf();
    if (!assets) return c.json({ error: { code: 'E_NOT_FOUND', message: '媒体模块未挂载' } }, 404);
    const tenantId = c.req.query('tenant') ?? deps.tenantId;
    const found = await assets.read(c.req.param('id'), tenantId);
    if (!found) return c.json({ error: { code: 'E_NOT_FOUND', message: '资产不存在' } }, 404);
    c.header('content-type', found.asset.contentType);
    c.header('cache-control', 'public, max-age=86400, immutable');
    return c.body(found.data as unknown as ArrayBuffer);
  });

  // GET /api/v1/search —— 全文检索（search 模块贡献；未加载 → 404）
  // 注意：**必须注册在 /:type 之前**，否则 'search' 会被当成内容类型。
  // 可见性同列表：匿名只搜 published；草稿需凭证（预览门）。
  contentApi.get('/search', async (c) => {
    const search = deps.registry.get<SearchProvider>('search');
    if (!search) return notFound(c);
    const q = c.req.query();
    const text = q['q'] ?? '';
    if (!text.trim()) {
      return c.json({ error: { code: 'E_VALIDATION', message: '缺少查询词 q' } }, 400);
    }

    const statusParam = q['status'];
    const wantsPreview = statusParam !== undefined && statusParam !== 'published';
    const principal = wantsPreview ? await previewPrincipal(c) : null;
    if (wantsPreview && !principal) {
      return c.json(
        { error: { code: 'E_FORBIDDEN', message: 'status 非 published 的查询需要凭证（预览）' } },
        403
      );
    }

    const result = await search.search({
      index: q['type'] ?? '',
      tenantId: q['tenant'] ?? deps.tenantId,
      text,
      // 匿名只搜已发布；预览（有凭证）不过滤状态
      filter: principal ? undefined : { status: 'published' },
      limit: q['limit'] ? Math.min(Number(q['limit']), 50) : 20,
      offset: q['offset'] ? Number(q['offset']) : 0,
    });

    c.header('Cache-Control', principal ? 'private, no-store' : 'public, max-age=60');
    const fields = parseFields(q);
    return c.json({
      items: fields
        ? result.hits.map((h) => ({
            ...h,
            document: projectFields((h.document ?? {}) as Record<string, unknown>, fields),
          }))
        : result.hits,
      total: result.total,
    });
  });

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

    // 预览门：status 非 published（含 all）属于草稿读取，必须带凭证
    const wantsPreview = status !== 'published';
    const principal = wantsPreview ? await previewPrincipal(c) : null;
    if (wantsPreview && !principal) {
      return c.json(
        { error: { code: 'E_FORBIDDEN', message: 'status 非 published 的查询需要凭证（预览）' } },
        403
      );
    }

    const tenantId = q['tenant'] ?? deps.tenantId;
    const produce = (): Promise<unknown> =>
      deps.content.find({
        type,
        tenantId,
        locale: q['locale'],
        status: status === 'all' ? undefined : status,
        filters: filters.length > 0 ? filters : undefined,
        limit: q['limit'] ? Math.min(Number(q['limit']), 100) : 20,
        offset: q['offset'] ? Number(q['offset']) : 0,
      });

    // 预览请求**绕过共享缓存**（不读不写）——草稿绝不落公共缓存
    const { value, hit } = principal
      ? { value: await produce(), hit: false }
      : await withCache(tenantId, c.req.path + '?' + new URL(c.req.url).search, produce);

    const page = value as { items: unknown[]; total: number };
    if (hit) c.header('x-cache', 'HIT');
    // 匿名读可进 CDN；预览响应禁止共享缓存
    c.header('Cache-Control', principal ? 'private, no-store' : 'public, max-age=60');
    // ?fields= 裁剪：缓存键含完整 query，故不同裁剪各自成条目，不会互相串味
    const fields = parseFields(q);
    return c.json({
      items: page.items.map((it) => projectFields(it as Record<string, unknown>, fields)),
      total: page.total,
    });
  });

  // GET /api/v1/:type/:key —— key 为 UUID 时按 id，否则按 slug
  // 匿名只可见 published；草稿/全部状态需凭证
  contentApi.get('/:type/:key', async (c) => {
    const type = c.req.param('type');
    const key = c.req.param('key');
    const tenantId = c.req.query('tenant') ?? deps.tenantId;
    const statusParam = c.req.query('status');
    const principal = await previewPrincipal(c);

    let entity: Record<string, unknown> | null = null;
    if (UUID_RE.test(key)) {
      // findOne 不过滤 status：先取回，再按凭证判定可见性
      const found = await deps.content.findOne(key, tenantId);
      if (found && found.type === type) entity = found as unknown as Record<string, unknown>;
    } else {
      // 无凭证时强制 published（忽略调用方的 status 参数）；有凭证才按参数取
      const status = principal ? (statusParam ?? 'published') : 'published';
      const page = await deps.content.find({
        type,
        tenantId,
        status: status === 'all' ? undefined : status,
        filter: { slug: key },
        limit: 1,
      });
      entity = (page.items[0] as unknown as Record<string, unknown>) ?? null;
    }

    // 非 published 且无凭证 → 404（不泄漏"此处存在一篇草稿"）
    if (entity && !principal && entity['status'] !== 'published') entity = null;
    if (!entity) return c.json({ error: { code: 'E_NOT_FOUND', message: '条目不存在' } }, 404);

    c.header('Cache-Control', principal ? 'private, no-store' : 'public, max-age=60');
    return c.json(projectFields(entity, parseFields(c.req.query())));
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

  // GET /api/manage/v1/assets —— 资产列表（媒体模块贡献）
  manage.get('/assets', async (c) => {
    const assets = assetsOf();
    if (!assets) return notFound(c);
    return c.json({ items: await assets.list(c.get('tenantId') as string) });
  });

  // POST /api/manage/v1/assets —— 上传（multipart: file 字段）
  manage.post('/assets', async (c) => {
    const assets = assetsOf();
    if (!assets) return notFound(c);
    const auth = await authorize(c, 'assets', 'create');
    if ('denied' in auth) return auth.denied;
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return c.json({ error: { code: 'E_VALIDATION', message: '需要 multipart 字段 file' } }, 400);
    }
    const id = newId();
    const asset = await assets.put({
      id,
      tenantId: c.get('tenantId') as string,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      data: new Uint8Array(await file.arrayBuffer()),
    });
    return c.json({ ...asset, url: `/api/v1/assets/${id}` }, 201);
  });

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

  // DELETE /api/manage/v1/assets/:id
  manage.delete('/assets/:id', async (c) => {
    const assets = assetsOf();
    if (!assets) return notFound(c);
    const auth = await authorize(c, 'assets', 'delete');
    if ('denied' in auth) return auth.denied;
    await assets.remove(c.req.param('id'), c.get('tenantId') as string);
    return c.json({ ok: true });
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
