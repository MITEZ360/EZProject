// 博客前台（专用场景展示层）：SSR HTML 页面由 PT 渲染生成，不存产物。

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import { bootstrap } from '@kernel/bootstrap.js';
import { Tokens } from '@kernel/registry.js';
import { storageModule } from '@modules/storage/index.js';
import { contentModule } from '@modules/content/index.js';
import { createBlogFront } from '@scenarios/blog/front/index.js';
import { blogTypes } from '@scenarios/blog/index.js';

const TENANT = 'tenant01';
const actor = { id: 'u', tenantId: TENANT, kind: 'user' };

async function bootFront(): Promise<{ root: Hono; content: ContentService; stop: () => Promise<void> }> {
  const app = await bootstrap({
    modules: [
      storageModule({ dialect: 'sqlite', url: ':memory:' }),
      contentModule(blogTypes),
    ],
  });
  const content = app.registry.require<ContentService>(Tokens.Content);
  const front = createBlogFront({ content, tenantId: TENANT, siteTitle: '测试博客' });
  const root = new Hono();
  root.route('/', front);
  return { root, content, stop: () => app.stop() };
}

const body = [
  { _type: 'block', _key: 'k1', style: 'h1', children: [{ _type: 'span', _key: 's1', text: '正文标题' }], markDefs: [] },
  { _type: 'block', _key: 'k2', style: 'normal', children: [{ _type: 'span', _key: 's2', text: '段落内容' }], markDefs: [] },
];

describe('博客前台（SSR）', () => {
  it('列表页只出已发布；详情页渲染 PT；未发布/不存在 404', async () => {
    const { root, content, stop } = await bootFront();
    await content.create({
      type: 'posts', tenantId: TENANT, data: { title: '已发布', slug: 'pub', body, status: 'published' }, actor,
    });
    await content.create({
      type: 'posts', tenantId: TENANT, data: { title: '草稿', slug: 'draft', body }, actor,
    });

    const home = await root.request('/');
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain('已发布');
    expect(html).not.toContain('草稿'); // 草稿不出现
    expect(html).toContain('测试博客');

    const detail = await root.request('/posts/pub');
    expect(detail.status).toBe(200);
    const d = await detail.text();
    expect(d).toContain('<h1>正文标题</h1>'); // PT 渲染产物（非存储）
    expect(d).toContain('<p>段落内容</p>');

    expect((await root.request('/posts/draft')).status).toBe(404); // 未发布不可见
    expect((await root.request('/posts/nope')).status).toBe(404);
    await stop();
  });

  it('XSS：标题/正文中的 HTML 被转义', async () => {
    const { root, content, stop } = await bootFront();
    await content.create({
      type: 'posts',
      tenantId: TENANT,
      data: {
        title: '<script>alert(1)</script>',
        slug: 'xss',
        status: 'published',
        body: [{ _type: 'block', _key: 'k', style: 'normal', children: [{ _type: 'span', _key: 's', text: '<img src=x onerror=alert(1)>' }], markDefs: [] }],
      },
      actor,
    });
    const html = await (await root.request('/posts/xss')).text();
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img'); // 原始标签未出现（onerror 文本已被转义为无害文本）
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    await stop();
  });

  it('空站点渲染引导页', async () => {
    const { root, stop } = await bootFront();
    const html = await (await root.request('/')).text();
    expect(html).toContain('暂无文章');
    await stop();
  });
});
