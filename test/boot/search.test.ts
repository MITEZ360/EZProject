// 全文检索模块验证：增量索引（事件驱动、强一致）、中文子串检索、可见性与过滤。
//
// **跨方言契约测试**：同一套断言同时跑 sqlite(FTS5) 与 postgres(tsvector)。
// 两方言的查询语法不同（`"世 界"` vs `世 <-> 界`），但语义必须一致——
// 这正是本文件参数化的意义：任何一方偏离都会在这里暴露。
// 切分策略（方言无关）见 test/unit/search-tokenize.test.ts。
//
// PG 用例需真实库：设 TEST_PG_URL 才跑，且必须串行
// （多文件并行会争抢同一个库的建表/清表，见 Makefile test-pg）。

import { describe, it, expect, afterEach } from 'vitest';
import { createBlogApp } from '@scenarios/blog/index.js';
import { allowAllGuard, HttpTokens, type HttpApp } from '@modules/http/index.js';
import { httpModule } from '@modules/http/index.js';
import { contentModule } from '@modules/content/index.js';
import { storageModule } from '@modules/storage/index.js';
import { createStorageDriver } from '@modules/storage/factory.js';
import { bootstrap, type App } from '@kernel/bootstrap.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { Dialect } from '@kernel/contracts/storage.contract.js';
import { Tokens } from '@kernel/registry.js';
import { blogTypes } from '@scenarios/blog/index.js';

const TENANT = 'tenant01';
const actor = { id: 'u1', tenantId: TENANT, kind: 'user' };

const PT = (text: string): unknown[] => [
  { _type: 'block', _key: 'k1', style: 'normal', children: [{ _type: 'span', _key: 's1', text }], markDefs: [] },
];

interface DialectCase {
  name: string;
  dialect: Dialect;
  url: string;
}

const DIALECTS: DialectCase[] = [{ name: 'sqlite', dialect: 'sqlite', url: ':memory:' }];
const PG_URL = process.env['TEST_PG_URL'];
if (PG_URL) DIALECTS.push({ name: 'postgres', dialect: 'postgres', url: PG_URL });

/** PG 是持久库：每例开跑前清空（sqlite 用 :memory: 天然干净） */
const PG_DROP =
  'DROP TABLE IF EXISTS search_index, entries, content_types, auth_users, auth_roles, auth_refresh_tokens, settings, assets, audit_logs CASCADE';

interface SearchBody {
  total: number;
  items: Array<{ id: string; score: number; document: { data: { title?: string } } }>;
}

let app: App;
let api: HttpApp;

async function boot(d: DialectCase, withToken = false): Promise<void> {
  if (d.dialect === 'postgres') {
    const clean = createStorageDriver({ dialect: 'postgres', url: d.url });
    await clean.transaction((tx) => tx.exec(PG_DROP));
    await clean.close();
  }
  app = await createBlogApp({
    dialect: d.dialect,
    url: d.url,
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

describe.each(DIALECTS)('全文检索（$name）', (d) => {
  it('创建后立即可搜（事件驱动，强一致）：中文子串命中', async () => {
    await boot(d);
    await create({ title: '你好世界', slug: 'a', body: PT('这是关于全文搜索的文章'), status: 'published' });

    const r = await search('q=世界'); // 2 字子串——默认分词器做不到，单字切分可以
    expect(r.total).toBe(1);
    expect(r.items[0]?.document.data.title).toBe('你好世界');
  });

  it('正文（Portable Text）中的文本同样可搜', async () => {
    await boot(d);
    await create({ title: '标题无关', slug: 'b', body: PT('正文里提到分布式事务'), status: 'published' });

    expect((await search('q=分布式事务')).total).toBe(1);
    expect((await search('q=不存在的词')).total).toBe(0);
  });

  it('短语语义：token 必须相邻（跨方言一致）', async () => {
    await boot(d);
    await create({ title: '甲', slug: 'adj', body: PT('世界你好'), status: 'published' });

    expect((await search('q=世界')).total).toBe(1);
    expect((await search('q=界世')).total).toBe(0); // 逆序不命中
    expect((await search('q=世好')).total).toBe(0); // 不相邻不命中（中间隔着「界」）
  });

  it('更新后索引同步：旧词搜不到、新词搜得到', async () => {
    await boot(d);
    await create({ title: '旧标题甲', slug: 'c', body: PT('原文'), status: 'published' });
    expect((await search('q=旧标题甲')).total).toBe(1);

    const page = await content().find({ type: 'posts', tenantId: TENANT, filter: { slug: 'c' }, limit: 1 });
    const id = page.items[0]!.id;
    await content().update(id, { tenantId: TENANT, data: { title: '新标题乙' }, actor });

    expect((await search('q=旧标题甲')).total).toBe(0);
    expect((await search('q=新标题乙')).total).toBe(1);
  });

  it('重复索引同一文档不会产生重复命中（upsert 语义）', async () => {
    await boot(d);
    await create({ title: '幂等测试', slug: 'idem', body: PT('关键词内容'), status: 'published' });

    // FTS5 侧靠"先删后插"、PG 侧靠 ON CONFLICT —— 两条路径都必须收敛为一行
    const page = await content().find({ type: 'posts', tenantId: TENANT, filter: { slug: 'idem' }, limit: 1 });
    await content().update(page.items[0]!.id, { tenantId: TENANT, data: { title: '幂等测试' }, actor });
    await content().update(page.items[0]!.id, { tenantId: TENANT, data: { title: '幂等测试' }, actor });

    const r = await search('q=关键词内容');
    expect(r.total).toBe(1);
    expect(r.items).toHaveLength(1);
  });

  it('软删除后索引移除', async () => {
    await boot(d);
    await create({ title: '待删除', slug: 'd', body: PT('内容'), status: 'published' });
    expect((await search('q=待删除')).total).toBe(1);

    const page = await content().find({ type: 'posts', tenantId: TENANT, filter: { slug: 'd' }, limit: 1 });
    await content().remove(page.items[0]!.id, TENANT, actor);

    expect((await search('q=待删除')).total).toBe(0);
  });

  it('可见性：匿名只搜 published，草稿不可见', async () => {
    await boot(d);
    await create({ title: '已发布篇', slug: 'p', body: PT('公开内容'), status: 'published' });
    await create({ title: '草稿篇', slug: 'k', body: PT('未公开内容') });

    const anon = await search('q=内容');
    expect(anon.total).toBe(1);
    expect(anon.items[0]?.document.data.title).toBe('已发布篇');

    // 草稿关键词匿名搜不到
    expect((await search('q=未公开')).total).toBe(0);
  });

  it('可见性：带凭证可搜草稿（预览），且响应不共享缓存', async () => {
    await boot(d, true);
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
    await boot(d);
    await create({ title: '文章甲', slug: 't1', body: PT('共享关键词'), status: 'published' });

    expect((await search('q=共享关键词&type=posts')).total).toBe(1);
    expect((await search('q=共享关键词&type=others')).total).toBe(0);
  });

  it('缺少查询词 / 纯空白 → 400', async () => {
    await boot(d);
    expect((await api.request('/api/v1/search')).status).toBe(400);
    expect((await api.request('/api/v1/search?q=%20%20')).status).toBe(400);
  });

  it('分页与总数：limit/offset 与 total 一致', async () => {
    await boot(d);
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

// 路由契约（与方言无关，跑一次即可）
describe('search 能力未挂载', () => {
  it('模块未加载 → /api/v1/search 返回 404，且不影响其它路由', async () => {
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
});
