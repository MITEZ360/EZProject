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

  it('自定义字段查询：?filter[字段][操作]=值（决策 #26 透出到 API）', async () => {
    await boot({ guard: 'allowAll' });
    const c = content();
    await c.defineType(
      {
        slug: 'products',
        fields: [
          { name: 'name', type: 'text' },
          { name: 'price', type: 'number' },
          { name: 'tags', type: 'select', options: ['hot', 'cold', 'sale'], multiple: true },
        ],
      },
      actor
    );
    const mk = (slug: string, price: number, tags: string[]) =>
      c.create({
        type: 'products',
        tenantId: 'tenant01',
        data: { name: slug, slug, status: 'published', price, tags },
        actor,
      });
    await mk('p1', 10, ['cold']);
    await mk('p2', 50, ['hot', 'sale']);
    await mk('p3', 100, ['hot']);

    // eq：JSON 字段等值
    const eq = await api.request('/api/v1/products?filter[price][eq]=50');
    expect(((await eq.json()) as { total: number }).total).toBe(1);

    // 范围：gte + lt（AND）
    const range = await api.request('/api/v1/products?filter[price][gte]=50&filter[price][lt]=100');
    expect(((await range.json()) as { total: number }).total).toBe(1);

    // contains（数组包含）
    const hot = await api.request('/api/v1/products?filter[tags][contains]=hot');
    expect(((await hot.json()) as { total: number }).total).toBe(2);

    // in（顶层列）
    const inq = await api.request('/api/v1/products?filter[slug][in]=p1,p3');
    expect(((await inq.json()) as { total: number }).total).toBe(2);

    // 非法操作符 → 400
    const bad = await api.request('/api/v1/products?filter[price][between]=1');
    expect(bad.status).toBe(400);
  });

  it('草稿预览需凭证：匿名 ?status=all → 403；带凭证可读且禁止共享缓存', async () => {
    await boot({ guard: 'allowAll', manageToken: 'preview-tk' });
    await content().create({ type: 'posts', tenantId: 'tenant01', data: POST, actor });

    // 匿名：草稿列表不可读（修复前这里完全公开）
    const anon = await api.request('/api/v1/posts?status=all');
    expect(anon.status).toBe(403);

    // 带预览凭证：可读，且响应不进共享缓存
    const preview = await api.request('/api/v1/posts?status=all', {
      headers: { authorization: 'Bearer preview-tk' },
    });
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { total: number }).total).toBe(1);
    expect(preview.headers.get('cache-control')).toContain('no-store');
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
    expect(bare.loadedModules()).toEqual(
      ['storage', 'cache', 'authz', 'content', 'media', 'search', 'audit', 'settings', 'webhook']
    );
    expect(bare.registry.has(HttpTokens.App)).toBe(false);
    await bare.stop();
  });

  it('模块依赖拓扑：http 排在 content 前也能正确装载', async () => {
    const app2 = await bootstrapModulesOrder();
    expect(app2.loadedModules()).toEqual(['storage', 'content', 'http']); // 手工装配，未含 authz
    await app2.stop();
  });

  it('静态托管开启时：未匹配的 API 路径回 404 JSON，不被 SPA 兜底吞掉', async () => {
    const app3 = await createBlogApp({
      dialect: 'sqlite',
      url: ':memory:',
      tenantId: 'tenant01',
      http: { guard: allowAllGuard(), tenantId: 'tenant01', staticDir: 'no-such-static-dir' },
    });
    const api3 = app3.registry.require<HttpApp>(HttpTokens.App);
    const res = await api3.request('/api/unknown');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('E_NOT_FOUND');
    await app3.stop();
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

describe('字段裁剪 ?fields=（减小 payload）', () => {
  /** 造一条已发布内容，附带一个多余字段用于观察裁剪 */
  async function seed(): Promise<void> {
    await boot({ guard: 'allowAll' });
    await content().create({
      type: 'posts',
      tenantId: 'tenant01',
      data: { ...POST, status: 'published' },
      actor,
    });
  }

  it('列表：只返回指定字段；顶层结构列不受影响', async () => {
    await seed();
    const res = await api.request('/api/v1/posts?fields=title');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items: Record<string, unknown>[]; total: number };
    const item = json.items[0]!;
    expect(item['data']).toEqual({ title: '你好' });
    // 结构信息不参与裁剪——否则调用方无法定位/判断条目
    expect(item['id']).toBeDefined();
    expect(item['slug']).toBe('hello');
    expect(item['status']).toBe('published');
    expect(typeof item['updatedAt']).toBe('number');
    expect(json.total).toBe(1);
  });

  it('未知字段名被忽略（不报错、也不凭空造键）', async () => {
    await seed();
    const res = await api.request('/api/v1/posts?fields=title,nope,also-nope');
    const json = (await res.json()) as { items: Record<string, unknown>[] };
    expect(json.items[0]!['data']).toEqual({ title: '你好' });
  });

  it('详情路由同样生效', async () => {
    await seed();
    const res = await api.request('/api/v1/posts/hello?fields=body');
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['data']).toEqual({ body: POST.body });
    expect(json['slug']).toBe('hello');
  });

  it('不传 fields → 完整 data（向后兼容）', async () => {
    await seed();
    const res = await api.request('/api/v1/posts');
    const json = (await res.json()) as { items: Record<string, unknown>[] };
    const data = json.items[0]!['data'] as Record<string, unknown>;
    expect(data['title']).toBe('你好');
    expect(data['body']).toBeDefined();
  });

  it('fields 为空串 / 纯逗号 → 视作未指定（不返回空 data）', async () => {
    await seed();
    for (const qs of ['fields=', 'fields=,,', 'fields=%20']) {
      const res = await api.request(`/api/v1/posts?${qs}`);
      const json = (await res.json()) as { items: Record<string, unknown>[] };
      expect((json.items[0]!['data'] as Record<string, unknown>)['body']).toBeDefined();
    }
  });

  it('裁剪后的响应仍可缓存（缓存键含 query，不同裁剪互不串味）', async () => {
    await seed();
    const a = await api.request('/api/v1/posts?fields=title');
    const b = await api.request('/api/v1/posts?fields=body');
    expect(a.headers.get('cache-control')).toContain('public');
    const aj = (await a.json()) as { items: Record<string, unknown>[] };
    const bj = (await b.json()) as { items: Record<string, unknown>[] };
    expect(aj.items[0]!['data']).toEqual({ title: '你好' });
    expect(bj.items[0]!['data']).toEqual({ body: POST.body }); // 未被上一次请求污染
  });
});
