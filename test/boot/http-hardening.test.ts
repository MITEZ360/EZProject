// HTTP 加固验证：内容预览门（草稿访问控制）+ 限流。
//
// 两者都是阶段二明列但此前缺失的能力；预览门同时修掉一个真实缺口——
// 修复前：Content API 匿名即可用 ?status=all 读草稿，且**按 UUID 取单篇完全不过滤 status**。

import { describe, it, expect, afterEach } from 'vitest';
import { createBlogApp } from '@scenarios/blog/index.js';
import { allowAllGuard, HttpTokens, type HttpApp, type HttpModuleOptions } from '@modules/http/index.js';
import type { App } from '@kernel/bootstrap.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import { Tokens } from '@kernel/registry.js';

const TENANT = 'tenant01';
const actor = { id: 'u1', tenantId: TENANT, kind: 'user' };

const BODY = [
  { _type: 'block', _key: 'k1', style: 'normal', children: [{ _type: 'span', _key: 's1', text: '正文' }] },
];

let app: App;
let api: HttpApp;

async function boot(opts: { manageToken?: string; rateLimit?: HttpModuleOptions['rateLimit'] } = {}): Promise<void> {
  app = await createBlogApp({
    dialect: 'sqlite',
    url: ':memory:',
    tenantId: TENANT,
    http: {
      tenantId: TENANT,
      guard: allowAllGuard(),
      manageToken: opts.manageToken,
      ...(opts.rateLimit ? { rateLimit: opts.rateLimit } : {}),
    },
  });
  api = app.registry.require<HttpApp>(HttpTokens.App);
}

const content = (): ContentService => app.registry.require<ContentService>(Tokens.Content);

afterEach(async () => {
  await app?.stop();
});

describe('内容预览门：草稿访问控制', () => {
  it('列表：匿名 ?status=all / ?status=draft → 403（修复前完全公开）', async () => {
    await boot();
    await content().create({ type: 'posts', tenantId: TENANT, data: { title: '草稿', slug: 'd1', body: BODY }, actor });

    expect((await api.request('/api/v1/posts?status=all')).status).toBe(403);
    expect((await api.request('/api/v1/posts?status=draft')).status).toBe(403);
  });

  it('列表：匿名默认只出 published（草稿不可见）', async () => {
    await boot();
    const c = content();
    await c.create({ type: 'posts', tenantId: TENANT, data: { title: '草稿', slug: 'd1', body: BODY }, actor });
    await c.create({
      type: 'posts', tenantId: TENANT, data: { title: '已发', slug: 'p1', body: BODY, status: 'published' }, actor,
    });

    const res = await api.request('/api/v1/posts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; items: Array<{ data: { title: string } }> };
    expect(body.total).toBe(1);
    expect(body.items[0]?.data.title).toBe('已发');
    expect(res.headers.get('cache-control')).toContain('public');
  });

  it('详情按 UUID 取草稿：匿名 404（不泄漏存在性）；带凭证 200 且 no-store', async () => {
    await boot({ manageToken: 'preview-tk' });
    const draft = await content().create({
      type: 'posts', tenantId: TENANT, data: { title: 'UUID 草稿', slug: 'uuid-draft', body: BODY }, actor,
    });

    const anon = await api.request(`/api/v1/posts/${draft.id}`);
    expect(anon.status).toBe(404); // 修复前：完全不过滤 status，直接返回草稿

    const preview = await api.request(`/api/v1/posts/${draft.id}`, {
      headers: { authorization: 'Bearer preview-tk' },
    });
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { data: { title: string } }).data.title).toBe('UUID 草稿');
    expect(preview.headers.get('cache-control')).toContain('no-store');
  });

  it('详情按 slug：匿名 ?status=draft 被忽略（仍只见 published）', async () => {
    await boot();
    await content().create({ type: 'posts', tenantId: TENANT, data: { title: '草稿', slug: 's1', body: BODY }, actor });

    // 即使显式传 status=draft，匿名也拿不到
    expect((await api.request('/api/v1/posts/s1?status=draft')).status).toBe(404);
    expect((await api.request('/api/v1/posts/s1')).status).toBe(404);
  });

  it('预览读取绕过共享缓存：草稿绝不泄漏给匿名请求', async () => {
    await boot({ manageToken: 'preview-tk' });
    await content().create({ type: 'posts', tenantId: TENANT, data: { title: '草稿', slug: 'leak', body: BODY }, actor });

    // 带凭证读 status=all：拉到草稿
    const preview = await api.request('/api/v1/posts?status=all', {
      headers: { authorization: 'Bearer preview-tk' },
    });
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { total: number }).total).toBe(1);

    // 同一 URL 匿名请求：仍 403（而非从缓存里拿到草稿）
    expect((await api.request('/api/v1/posts?status=all')).status).toBe(403);

    // 匿名默认读：0 条 —— 公共缓存未被草稿污染
    const pub = await api.request('/api/v1/posts');
    expect(((await pub.json()) as { total: number }).total).toBe(0);
  });
});

describe('限流', () => {
  it('Content API：超限 → 429 + Retry-After + E_RATE_LIMITED', async () => {
    await boot({ rateLimit: { apiMax: 3, windowSeconds: 60 } });
    const headers = { 'x-forwarded-for': '9.9.9.9' };

    for (let i = 0; i < 3; i++) {
      expect((await api.request('/api/v1/posts', { headers })).status).toBe(200);
    }
    const limited = await api.request('/api/v1/posts', { headers });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('E_RATE_LIMITED');
  });

  it('不同来源 IP 各自独立计数', async () => {
    await boot({ rateLimit: { apiMax: 2 } });
    const a = { 'x-forwarded-for': '1.1.1.1' };
    const b = { 'x-forwarded-for': '2.2.2.2' };

    await api.request('/api/v1/posts', { headers: a });
    await api.request('/api/v1/posts', { headers: a });
    expect((await api.request('/api/v1/posts', { headers: a })).status).toBe(429); // a 已用尽
    expect((await api.request('/api/v1/posts', { headers: b })).status).toBe(200); // b 不受影响
  });

  it('登录端点独立额度（防爆破），不影响 Content API', async () => {
    await boot({ rateLimit: { apiMax: 100, loginMax: 2 }, manageToken: 'tk' });
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': '8.8.8.8' };
    const login = async (): Promise<Response> =>
      api.request('/api/manage/v1/auth/login', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: 'nobody@example.com', password: 'whatever-1' }),
      });

    expect((await login()).status).toBe(401); // 用户不存在 → 统一 401
    expect((await login()).status).toBe(401);
    expect((await login()).status).toBe(429); // 第 3 次触顶

    // 同一 IP 的 Content API 额度独立，仍可用
    expect((await api.request('/api/v1/posts', { headers: { 'x-forwarded-for': '8.8.8.8' } })).status).toBe(200);
  });

  it('rateLimit.enabled=false 完全关闭（优先于额度）', async () => {
    await boot({ rateLimit: { enabled: false, apiMax: 1 } });
    const headers = { 'x-forwarded-for': '5.5.5.5' };
    for (let i = 0; i < 3; i++) {
      expect((await api.request('/api/v1/posts', { headers })).status).toBe(200);
    }
  });
});
