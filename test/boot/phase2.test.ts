// test/boot/phase2.test.ts
// 阶段二能力：媒体资产（local 策略）、读缓存（命中/失效）、多语言回退。

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { App } from '@kernel/bootstrap.js';
import type { AssetStore } from '@kernel/contracts/asset.contract.js';
import type { CacheProvider } from '@kernel/contracts/cache.contract.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { EntityTypeDef } from '@kernel/primitives/entity.js';
import { bootstrap } from '@kernel/bootstrap.js';
import { Tokens } from '@kernel/registry.js';
import { storageModule } from '@modules/storage/index.js';
import { contentModule } from '@modules/content/index.js';
import { mediaModule } from '@modules/media/index.js';
import { cacheModule } from '@modules/cache/index.js';
import { httpModule, HttpTokens, type HttpApp } from '@modules/http/index.js';
import { authzModule } from '@modules/authz/index.js';

const TENANT = 'tenant01';
const BOOT = 'boot-token';
const posts: EntityTypeDef = {
  slug: 'posts',
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'body', type: 'richText' },
    { name: 'cover', type: 'media' },
  ],
};

async function bootApp(mediaRoot: string): Promise<{ app: App; api: HttpApp; token: string }> {
  const app = await bootstrap({
    modules: [
      storageModule({ dialect: 'sqlite', url: ':memory:' }),
      cacheModule({ dialect: 'memory' }),
      authzModule({ jwtSecret: 'test-secret' }),
      contentModule([posts]),
      mediaModule({ root: mediaRoot }),
      httpModule({ tenantId: TENANT, manageToken: BOOT }),
    ],
  });
  const api = app.registry.require<HttpApp>(HttpTokens.App);
  await api.request('/api/manage/v1/auth/bootstrap', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${BOOT}` },
    body: JSON.stringify({ email: 'a@example.com', password: 'password-123' }),
  });
  const login = await api.request('/api/manage/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@example.com', password: 'password-123' }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  return { app, api, token: accessToken };
}

describe('媒体资产（local 策略）', () => {
  it('上传 → 元信息/文件落盘 → 列表 → 下载 → 删除', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cms-media-'));
    try {
      const { app, api, token } = await bootApp(root);
      const auth = { authorization: `Bearer ${token}` };

      const form = new FormData();
      form.set('file', new File([new Uint8Array([1, 2, 3, 4])], 'pic.png', { type: 'image/png' }));
      const up = await api.request('/api/manage/v1/assets', { method: 'POST', headers: auth, body: form });
      expect(up.status).toBe(201);
      const asset = (await up.json()) as { id: string; url: string; size: number; contentType: string };
      expect(asset.size).toBe(4);
      expect(asset.contentType).toBe('image/png');
      expect(existsSync(join(root, TENANT, asset.id))).toBe(true); // 文件真的落盘

      const list = await api.request('/api/manage/v1/assets', { headers: auth });
      expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);

      // 公开下载（Content API）
      const dl = await api.request(asset.url);
      expect(dl.status).toBe(200);
      expect(dl.headers.get('content-type')).toBe('image/png');
      expect(dl.headers.get('cache-control')).toContain('immutable');
      expect(new Uint8Array(await dl.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));

      // media 字段引用 asset id（铁律：存 id 不存 URL）
      const created = await api.request('/api/manage/v1/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ title: 't', body: [], cover: asset.id }),
      });
      expect(created.status).toBe(201);

      const del = await api.request(`/api/manage/v1/assets/${asset.id}`, { method: 'DELETE', headers: auth });
      expect(del.status).toBe(200);
      expect(existsSync(join(root, TENANT, asset.id))).toBe(false);
      await app.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('防路径穿越：非法 asset id 被拒', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cms-media-'));
    try {
      const app = await bootstrap({
        modules: [
          storageModule({ dialect: 'sqlite', url: ':memory:' }),
          mediaModule({ root }),
        ],
      });
      const assets = app.registry.require<AssetStore>(Tokens.Assets);
      await expect(
        assets.put({
          id: '../evil',
          tenantId: TENANT,
          filename: 'x',
          contentType: 'text/plain',
          data: new Uint8Array([1]),
        })
      ).rejects.toThrow(/非法资产 id/);
      await app.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('读缓存（memory 策略）', () => {
  it('Content API 列表二次请求命中缓存；写入后失效', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cms-cache-'));
    try {
      const { app, api, token } = await bootApp(root);
      const auth = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

      await api.request('/api/manage/v1/posts', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ title: 'a', slug: 'a', status: 'published', body: [] }),
      });

      const first = await api.request('/api/v1/posts');
      expect(first.headers.get('x-cache')).toBeNull(); // 未命中
      expect(((await first.json()) as { total: number }).total).toBe(1);

      const second = await api.request('/api/v1/posts');
      expect(second.headers.get('x-cache')).toBe('HIT'); // 命中

      // 写入 → 失效 → 再取是新数据
      await api.request('/api/manage/v1/posts', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ title: 'b', slug: 'b', status: 'published', body: [] }),
      });
      const third = await api.request('/api/v1/posts');
      expect(third.headers.get('x-cache')).toBeNull();
      expect(((await third.json()) as { total: number }).total).toBe(2);
      await app.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('CacheProvider：TTL 过期与按前缀失效', async () => {
    const app = await bootstrap({ modules: [cacheModule({ dialect: 'memory' })] });
    const cache = app.registry.require<CacheProvider>(Tokens.Cache);

    await cache.set('a:1', { v: 1 }, 1);
    expect(await cache.get('a:1')).toEqual({ v: 1 });
    await new Promise((r) => setTimeout(r, 1100));
    expect(await cache.get('a:1')).toBeNull(); // TTL 过期

    await cache.set('p:1', 1);
    await cache.set('p:2', 2);
    await cache.set('q:1', 3);
    await cache.invalidate('p:');
    expect(await cache.get('p:1')).toBeNull();
    expect(await cache.get('p:2')).toBeNull();
    expect(await cache.get('q:1')).toBe(3); // 前缀不匹配者保留
    await app.stop();
  });

  it('cache=none 时行为透明（不缓存）', async () => {
    const app = await bootstrap({ modules: [cacheModule({ dialect: 'none' })] });
    const cache = app.registry.require<CacheProvider>(Tokens.Cache);
    await cache.set('k', 1);
    expect(await cache.get('k')).toBeNull();
    await app.stop();
  });
});

describe('多语言回退（实体级 locale）', () => {
  it('请求 zh 无结果时回退 default', async () => {
    const app = await bootstrap({
      modules: [
        storageModule({ dialect: 'sqlite', url: ':memory:' }),
        contentModule([posts]),
      ],
    });
    const content = app.registry.require<ContentService>(Tokens.Content);
    const actor = { id: 'u', tenantId: TENANT, kind: 'user' };
    await content.create({ type: 'posts', tenantId: TENANT, locale: 'default', data: { title: '默认', body: [] }, actor });

    const zh = await content.find({ type: 'posts', tenantId: TENANT, locale: 'zh' });
    expect(zh.total).toBe(1); // 回退到 default
    expect(zh.items[0]?.locale).toBe('default');

    const en = await content.find({ type: 'posts', tenantId: TENANT, locale: 'en' });
    expect(en.total).toBe(1);

    // 明确存在 zh 版本时优先 zh
    await content.create({ type: 'posts', tenantId: TENANT, locale: 'zh', data: { title: '中文', body: [] }, actor });
    const zh2 = await content.find({ type: 'posts', tenantId: TENANT, locale: 'zh' });
    expect(zh2.total).toBe(1);
    expect(zh2.items[0]?.locale).toBe('zh');
    await app.stop();
  });
});
