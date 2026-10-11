// 全文检索模块验证：增量索引（事件驱动、强一致）、中文检索、可见性与过滤。
// 落地方案为 SQLite FTS5（零新依赖），切分策略见 test/unit/search-tokenize.test.ts。

import { describe, it, expect, afterEach } from 'vitest';
import { createBlogApp } from '@scenarios/blog/index.js';
import { allowAllGuard, HttpTokens, type HttpApp } from '@modules/http/index.js';
import { httpModule } from '@modules/http/index.js';
import { contentModule } from '@modules/content/index.js';
import { storageModule } from '@modules/storage/index.js';
import { bootstrap, type App } from '@kernel/bootstrap.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import { Tokens } from '@kernel/registry.js';
import { blogTypes } from '@scenarios/blog/index.js';

const TENANT = 'tenant01';
const actor = { id: 'u1', tenantId: TENANT, kind: 'user' };

const PT = (text: string): unknown[] => [
  { _type: 'block', _key: 'k1', style: 'normal', children: [{ _type: 'span', _key: 's1', text }], markDefs: [] },
];

interface SearchBody {
  total: number;
  items: Array<{ id: string; score: number; document: { data: { title?: string } } }>;
}

let app: App;
let api: HttpApp;

async function boot(withToken = false): Promise<void> {
  app = await createBlogApp({
    dialect: 'sqlite',
    url: ':memory:',
    tenantId: TENANT,
    http: { tenantId: TENANT, guard: allowAllGuard(), ...(withToken ? { manageToken: 'preview-tk' } : {}) },
  });
  api = app.registry.require<HttpApp>(HttpTokens.App);
}

const content = (): ContentService => app.registry.require<ContentService>(Tokens.Content);

async function create(data: Record<string, unknown>): Promise<void> {
  await content().create({ type: 'posts', tenantId: TENANT, data, actor });
}

const search = async (qs: string, headers?: Record<string, string>): Promise<SearchBody> => {
  const res = await api.request(`/api/v1/search?${qs}`, headers ? { headers } : undefined);
  expect(res.status).toBe(200);
  return (await res.json()) as SearchBody;
};

afterEach(async () => {
  await app?.stop();
});

describe('全文检索（FTS5）', () => {
  it('创建后立即可搜（事件驱动，强一致）：中文子串命中', async () => {
    await boot();
    await create({ title: '你好世界', slug: 'a', body: PT('这是关于全文搜索的文章'), status: 'published' });

    const r = await search('q=世界'); // 2 字子串——默认分词器做不到，单字切分可以
    expect(r.total).toBe(1);
    expect(r.items[0]?.document.data.title).toBe('你好世界');
  });

  it('正文（Portable Text）中的文本同样可搜', async () => {
    await boot();
    await create({ title: '标题无关', slug: 'b', body: PT('正文里提到分布式事务'), status: 'published' });

    expect((await search('q=分布式事务')).total).toBe(1);
    expect((await search('q=不存在的词')).total).toBe(0);
  });

  it('更新后索引同步：旧词搜不到、新词搜得到', async () => {
    await boot();
    await create({ title: '旧标题甲', slug: 'c', body: PT('原文'), status: 'published' });
    expect((await search('q=旧标题甲')).total).toBe(1);

    const page = await content().find({ type: 'posts', tenantId: TENANT, filter: { slug: 'c' }, limit: 1 });
    const id = page.items[0]!.id;
    await content().update(id, { tenantId: TENANT, data: { title: '新标题乙' }, actor });

    expect((await search('q=旧标题甲')).total).toBe(0);
    expect((await search('q=新标题乙')).total).toBe(1);
  });

  it('软删除后索引移除', async () => {
    await boot();
    await create({ title: '待删除', slug: 'd', body: PT('内容'), status: 'published' });
    expect((await search('q=待删除')).total).toBe(1);

    const page = await content().find({ type: 'posts', tenantId: TENANT, filter: { slug: 'd' }, limit: 1 });
    await content().remove(page.items[0]!.id, TENANT, actor);

    expect((await search('q=待删除')).total).toBe(0);
  });

  it('可见性：匿名只搜 published，草稿不可见', async () => {
    await boot();
    await create({ title: '已发布篇', slug: 'p', body: PT('公开内容'), status: 'published' });
    await create({ title: '草稿篇', slug: 'k', body: PT('未公开内容') });

    const anon = await search('q=内容');
    expect(anon.total).toBe(1);
    expect(anon.items[0]?.document.data.title).toBe('已发布篇');

    // 草稿关键词匿名搜不到
    expect((await search('q=未公开')).total).toBe(0);
  });

  it('可见性：带凭证可搜草稿（预览），且响应不共享缓存', async () => {
    await boot(true);
    await create({ title: '草稿篇', slug: 'k2', body: PT('未公开内容') });

    const res = await api.request('/api/v1/search?q=未公开&status=all', {
      headers: { authorization: 'Bearer preview-tk' },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as SearchBody).total).toBe(1);
    expect(res.headers.get('cache-control')).toContain('no-store');

    // 无凭证的 status=all → 403（与列表路由同一道预览门）
    expect((await api.request('/api/v1/search?q=未公开&status=all')).status).toBe(403);
  });

  it('按类型过滤：?type= 限定集合', async () => {
    await boot();
    await create({ title: '文章甲', slug: 't1', body: PT('共享关键词'), status: 'published' });

    expect((await search('q=共享关键词&type=posts')).total).toBe(1);
    expect((await search('q=共享关键词&type=others')).total).toBe(0);
  });

  it('缺少查询词 → 400', async () => {
    await boot();
    expect((await api.request('/api/v1/search')).status).toBe(400);
    expect((await api.request('/api/v1/search?q=%20%20')).status).toBe(400);
  });

  it('search 模块未加载 → /api/v1/search 返回 404（能力未挂载）', async () => {
    const bare = await bootstrap({
      modules: [
        storageModule({ dialect: 'sqlite', url: ':memory:' }),
        contentModule(blogTypes),
        httpModule({ guard: allowAllGuard(), tenantId: TENANT }),
      ],
    });
    const bareApi = bare.registry.require<HttpApp>(HttpTokens.App);
    expect((await bareApi.request('/api/v1/search?q=x')).status).toBe(404);
    // 且不影响其它路由（'search' 未被误当类型吞掉前）——列表仍可用
    expect((await bareApi.request('/api/v1/posts')).status).toBe(200);
    await bare.stop();
  });

  it('分页与总数：limit/offset 与 total 一致', async () => {
    await boot();
    for (let i = 0; i < 5; i++) {
      await create({ title: `分页测试 ${i}`, slug: `pg-${i}`, body: PT('共同词'), status: 'published' });
    }
    const first = await search('q=共同词&limit=2');
    expect(first.total).toBe(5);
    expect(first.items).toHaveLength(2);

    const second = await search('q=共同词&limit=2&offset=2');
    expect(second.total).toBe(5);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id); // 不同页
  });
});
