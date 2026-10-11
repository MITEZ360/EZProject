// test/boot/http.test.ts
// HTTP 层验证：Content API（只读/缓存头）+ Management API（守卫/CRUD）+ 错误映射。
// 用 Hono 的 app.request() 直发请求，无真实 socket（秒级，归启动测试层）。

import { describe, it, expect, afterEach } from 'vitest';
import { createBlogApp, blogTypes } from '@scenarios/blog/index.js';
import { httpModule, allowAllGuard, HttpTokens, type HttpApp } from '@modules/http/index.js';
import { contentModule } from '@modules/content/index.js';
import { storageModule } from '@modules/storage/index.js';
import { bootstrap, type App } from '@kernel/bootstrap.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import { Tokens } from '@kernel/registry.js';

let app: App;
let api: HttpApp;

async function boot(opts: { manageToken?: string; guard?: 'allowAll' } = {}): Promise<void> {
  app = await createBlogApp({
    dialect: 'sqlite',
    url: ':memory:',
    tenantId: 'tenant01',
    http: {
      tenantId: 'tenant01',
      manageToken: opts.manageToken,
      ...(opts.guard === 'allowAll' ? { guard: allowAllGuard() } : {}),
    },
  });
  api = app.registry.require<HttpApp>(HttpTokens.App);
}

afterEach(async () => {
  await app?.stop();
});

const POST = {
  title: '你好',
  slug: 'hello',
  body: [{ _type: 'block', _key: 'k1', style: 'normal', children: [{ _type: 'span', _key: 's1', text: 'hi' }] }],
};

const actor = { id: 'u', tenantId: 'tenant01', kind: 'user' };
const content = () => app.registry.require<ContentService>(Tokens.Content);

describe('Content API（只读 · 匿名 · 可缓存）', () => {
  it('GET /api/v1/:type 列表：默认只出 published，带 Cache-Control', async () => {
    await boot({ guard: 'allowAll' });
    // 造数据：一篇 draft、一篇 published（经 service 直写）
    await content().create({ type: 'posts', tenantId: 'tenant01', data: { ...POST, slug: 'draft-one' }, actor });
    const pub = await content().create({ type: 'posts', tenantId: 'tenant01', data: { ...POST, slug: 'pub-one', status: 'published' }, actor });

    const res = await api.request('/api/v1/posts');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('public');
    const json = (await res.json()) as { items: { id: string }[]; total: number };
    expect(json.items.map((i) => i.id)).toEqual([pub.id]); // draft 不出现
    expect(json.total).toBe(1);
  });

  it('GET /api/v1/:type/:slug 按 slug 取单篇', async () => {
    await boot({ guard: 'allowAll' });
    await content().create({ type: 'posts', tenantId: 'tenant01', data: { ...POST, status: 'published' }, actor });

    const res = await api.request('/api/v1/posts/hello');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { slug: string }).slug).toBe('hello');
  });

  it('不存在的条目返回 404', async () => {
    await boot({ guard: 'allowAll' });
    const res = await api.request('/api/v1/posts/no-such-slug');
    expect(res.status).toBe(404);
  });

  it('status=all 可取全部（含草稿，供预览类消费方）', async () => {
    await boot({ guard: 'allowAll' });
    await content().create({ type: 'posts', tenantId: 'tenant01', data: POST, actor });
    const res = await api.request('/api/v1/posts?status=all');
    expect(((await res.json()) as { total: number }).total).toBe(1);
  });
});

describe('Management API（写 · 守卫）', () => {
  it('无凭证 → 401', async () => {
    await boot({ manageToken: 'secret' });
    const res = await api.request('/api/manage/v1/posts', {
      method: 'POST',
      body: JSON.stringify(POST),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('Bearer Token 正确 → 201 创建；随后可查（draft 默认不出现在 Content API）', async () => {
    await boot({ manageToken: 'secret' });
    const res = await api.request('/api/manage/v1/posts', {
      method: 'POST',
      body: JSON.stringify(POST),
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; data: { title: string } };
    expect(created.data.title).toBe('你好');

    const pub = await api.request('/api/v1/posts');
    expect(((await pub.json()) as { total: number }).total).toBe(0); // 刚创建是 draft
  });

  it('PUT 更新 → 200；DELETE 软删除 → Content API 404', async () => {
    await boot({ manageToken: 'secret' });
    const headers = { 'content-type': 'application/json', authorization: 'Bearer secret' };

    const created = (await (
      await api.request('/api/manage/v1/posts', { method: 'POST', body: JSON.stringify(POST), headers })
    ).json()) as { id: string };

    const put = await api.request(`/api/manage/v1/posts/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({ title: '改了' }),
      headers,
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { data: { title: string } }).data.title).toBe('改了');

    const del = await api.request(`/api/manage/v1/posts/${created.id}`, { method: 'DELETE', headers });
    expect(del.status).toBe(200);

    const gone = await api.request(`/api/v1/posts/${created.id}`);
    expect(gone.status).toBe(404);
  });

  it('写入 HTML 正文被拒（内容铁律经 API 生效）→ 400', async () => {
    await boot({ manageToken: 'secret' });
    const res = await api.request('/api/manage/v1/posts', {
      method: 'POST',
      body: JSON.stringify({ ...POST, body: '<p>HTML</p>' }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('E_VALIDATION');
  });

  it('非法 JSON 请求体 → 400', async () => {
    await boot({ manageToken: 'secret' });
    const res = await api.request('/api/manage/v1/posts', {
      method: 'POST',
      body: 'not-json',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    });
    expect(res.status).toBe(400);
  });
});

describe('HTTP 模块可拔插（宪法一）', () => {
  it('不传 http 配置：storage+content 照常启动，无 http 模块', async () => {
    const bare = await createBlogApp({ dialect: 'sqlite', url: ':memory:' });
    expect(bare.loadedModules()).toEqual(['storage', 'content']);
    expect(bare.registry.has(HttpTokens.App)).toBe(false);
    await bare.stop();
  });

  it('模块依赖拓扑：http 排在 content 前也能正确装载', async () => {
    const app2 = await bootstrapModulesOrder();
    expect(app2.loadedModules()).toEqual(['storage', 'content', 'http']);
    await app2.stop();
  });
});

async function bootstrapModulesOrder(): Promise<App> {
  return bootstrap({
    modules: [
      httpModule({ guard: allowAllGuard(), tenantId: 'tenant01' }), // 故意放最前
      contentModule(blogTypes),
      storageModule({ dialect: 'sqlite', url: ':memory:' }),
    ],
  });
}
