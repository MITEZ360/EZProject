// modules/http/internal/app.ts
// Hono 应用构建：Content API（只读/匿名/可缓存）+ Management API（写/守卫）。
// 只依赖内核契约与 content 模块对外的 ContentService（经注册表注入），不 import 其他模块实现。

import { Hono } from 'hono';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { Principal } from '@kernel/primitives/principal.js';
import { statusOf, errorBody } from './errors.js';
import type { RequestGuard } from './guard.js';

/** Hono 上下文变量类型（中间件与路由间传递的主体/租户） */
type Vars = {
  Variables: { principal: Principal; tenantId: string };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HTTP 模块对外暴露的应用类型（场景/测试经 registry 取用） */
export type HttpApp = Hono<Vars>;

export interface HttpDeps {
  content: ContentService;
  guard: RequestGuard;
  /** 默认租户（场景注入；单租户场景的便捷） */
  tenantId: string;
}

export function buildApp(deps: HttpDeps): Hono<Vars> {
  const app = new Hono<Vars>();

  // ---------- Content API（对外 · 只读 · 匿名 · 可缓存） ----------
  const contentApi = new Hono<Vars>();

  // GET /api/v1/:type —— 列表（分页 + 过滤；默认只出 published）
  contentApi.get('/:type', async (c) => {
    const type = c.req.param('type');
    const q = c.req.query();
    const status = q['status'] ?? 'published';
    const page = await deps.content.find({
      type,
      tenantId: q['tenant'] ?? deps.tenantId,
      locale: q['locale'],
      status: status === 'all' ? undefined : status,
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

  // 守卫中间件：解析主体；失败 401
  manage.use('*', async (c, next) => {
    const tenantId = c.req.header('x-tenant-id') ?? deps.tenantId;
    const principal = await deps.guard(c.req.raw, tenantId);
    if (!principal) {
      return c.json({ error: { code: 'E_UNAUTHORIZED', message: '鉴权失败' } }, 401);
    }
    c.set('principal', principal);
    c.set('tenantId', tenantId);
    await next();
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
    try {
      const entity = await deps.content.create({
        type,
        tenantId,
        locale: typeof locale === 'string' ? locale : undefined,
        data,
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
    try {
      const entity = await deps.content.update(id, {
        tenantId,
        data,
        actor: principal,
      });
      return c.json(entity);
    } catch (e) {
      return c.json(errorBody(e), statusOf(e));
    }
  });

  // DELETE /api/manage/v1/:type/:id —— 软删除
  manage.delete('/:type/:id', async (c) => {
    const principal = c.get('principal') as Principal;
    const tenantId = c.get('tenantId') as string;
    try {
      await deps.content.remove(c.req.param('id'), tenantId, principal);
      return c.json({ ok: true });
    } catch (e) {
      return c.json(errorBody(e), statusOf(e));
    }
  });

  app.route('/api/v1', contentApi);
  app.route('/api/manage/v1', manage);

  // 健康检查（交付测试/编排探测用）
  app.get('/healthz', (c) => c.json({ ok: true }));

  return app;
}
