// scenarios/blog/front/index.ts
// 博客前台（专用场景的展示层）：服务端渲染 HTML 页面，消费内容服务。
// 铁律体现：页面在请求时由 Portable Text **渲染生成**，从不存储渲染产物。
// 只读、匿名——与 Content API 同一份数据源，两个消费方（前台页面 / 第三方 API）。

import { Hono } from 'hono';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { CacheProvider } from '@kernel/contracts/cache.contract.js';
import { ptToHtml, ptToPlainText, escapeHtml } from '@modules/content/render/pt-to-html.js';

export interface BlogFrontDeps {
  content: ContentService;
  tenantId: string;
  /** 站点标题（可从 settings 模块读取；此处由场景注入） */
  siteTitle?: string;
  cache?: CacheProvider;
}

/** 最小内联样式：不引入前端构建，保持"拷过去就能跑" */
const STYLE = `
  :root { color-scheme: light; }
  body { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px;
         font: 16px/1.75 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #222; }
  header.site { border-bottom: 1px solid #eee; padding-bottom: 16px; margin-bottom: 32px; }
  header.site a { color: inherit; text-decoration: none; font-weight: 700; font-size: 20px; }
  article h1 { font-size: 28px; line-height: 1.4; }
  .meta { color: #888; font-size: 13px; margin-top: 4px; }
  ul.posts { list-style: none; padding: 0; }
  ul.posts li { padding: 18px 0; border-bottom: 1px solid #f2f2f2; }
  ul.posts a { color: #c0392b; text-decoration: none; font-size: 18px; font-weight: 600; }
  ul.posts p { margin: 6px 0 0; color: #555; }
  blockquote { border-left: 3px solid #eee; margin-left: 0; padding-left: 16px; color: #555; }
  footer { margin-top: 48px; color: #aaa; font-size: 13px; }
`;

function layout(siteTitle: string, title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(siteTitle)}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="site"><a href="/">${escapeHtml(siteTitle)}</a></header>
${body}
<footer>由 Headless CMS 驱动 · 前台渲染产物不落库（每次请求从结构再生）</footer>
</body>
</html>`;
}

export function createBlogFront(deps: BlogFrontDeps): Hono {
  const app = new Hono();
  const site = deps.siteTitle ?? '博客';
  const cache = deps.cache;

  // GET / —— 已发布文章列表
  app.get('/', async (c) => {
    const key = `front:${deps.tenantId}:/`;
    let page = cache ? await cache.get<{ items: unknown[] }>(key) : null;
    if (!page) {
      page = await deps.content.find({
        type: 'posts',
        tenantId: deps.tenantId,
        status: 'published',
        limit: 20,
      });
      if (cache) await cache.set(key, page, 60);
    }
    const items = (page.items as Array<Record<string, unknown>>) ?? [];
    const list = items
      .map((it) => {
        const data = it['data'] as Record<string, unknown>;
        const title = escapeHtml(String(data['title'] ?? '(无标题)'));
        const slug = String(it['slug'] ?? '');
        const summary = escapeHtml(ptToPlainText(data['body'], 100));
        return `<li><a href="/posts/${encodeURIComponent(slug)}">${title}</a><p>${summary}</p></li>`;
      })
      .join('\n');
    const body =
      items.length > 0
        ? `<main><h1>最新文章</h1><ul class="posts">${list}</ul></main>`
        : '<main><h1>暂无文章</h1><p>去 <a href="/admin">管理后台</a> 发布第一篇吧。</p></main>';
    return c.html(layout(site, '首页', body));
  });

  // GET /posts/:slug —— 文章详情（渲染 PT，不存产物）
  app.get('/posts/:slug', async (c) => {
    const slug = c.req.param('slug');
    const page = await deps.content.find({
      type: 'posts',
      tenantId: deps.tenantId,
      status: 'published',
      filter: { slug },
      limit: 1,
    });
    const item = page.items[0] as Record<string, unknown> | undefined;
    if (!item) return c.html(layout(site, '未找到', '<main><h1>404</h1><p>文章不存在或未发布。</p></main>'), 404);

    const data = item['data'] as Record<string, unknown>;
    const title = String(data['title'] ?? '(无标题)');
    const html = ptToHtml(data['body']);
    const body = `<article>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">更新于 ${new Date(Number(item['updatedAt'])).toLocaleString()}</div>
  ${html}
</article>`;
    return c.html(layout(site, title, body));
  });

  return app;
}
