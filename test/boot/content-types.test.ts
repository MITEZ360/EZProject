// test/boot/content-types.test.ts
// 决策 #26 第二步：类型定义落库（逻辑 Schema）——运行时动态建类型 + 跨重启持久化。

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EntityTypeDef } from '@kernel/primitives/entity.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import { createBlogApp } from '@scenarios/blog/index.js';
import { allowAllGuard, HttpTokens, type HttpApp } from '@modules/http/index.js';
import { Tokens } from '@kernel/registry.js';
import { systemPrincipal } from '@kernel/primitives/principal.js';

const actor = systemPrincipal('tenant01');


const pageType: EntityTypeDef = {
  slug: 'pages',
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'body', type: 'richText' },
    { name: 'priority', type: 'number', integer: true, min: 0, max: 9 },
  ],
};

describe('类型定义落库（逻辑 Schema）', () => {
  it('defineType 后即可创建该类型条目（运行时动态建类型）', async () => {
    const app = await createBlogApp({ dialect: 'sqlite', url: ':memory:', tenantId: 'tenant01' });
    const content = app.registry.require<ContentService>(Tokens.Content);

    await content.defineType(pageType, actor);
    const entry = await content.create({
      type: 'pages',
      tenantId: 'tenant01',
      data: { title: '关于我们', body: [], priority: 3 },
      actor: { id: 'u', tenantId: 'tenant01', kind: 'user' },
    });
    expect(entry.type).toBe('pages');
    expect(entry.data['priority']).toBe(3);
    await app.stop();
  });

  it('listTypes 含内建通配类型 + 动态定义类型；getType 可查', async () => {
    const app = await createBlogApp({ dialect: 'sqlite', url: ':memory:', tenantId: 'tenant01' });
    const content = app.registry.require<ContentService>(Tokens.Content);
    await content.defineType(pageType, actor);

    const types = await content.listTypes('tenant01');
    const slugs = types.map((t) => t.slug).sort();
    expect(slugs).toContain('posts'); // 内建（'*' 通配）
    expect(slugs).toContain('pages'); // 动态定义
    expect((await content.getType('pages', 'tenant01'))?.fields).toHaveLength(3);
    expect(await content.getType('nope', 'tenant01')).toBeNull();
    await app.stop();
  });

  it('非法类型定义被拒（slug 格式 / 保留键字段名 / select 无 options）', async () => {
    const app = await createBlogApp({ dialect: 'sqlite', url: ':memory:', tenantId: 'tenant01' });
    const content = app.registry.require<ContentService>(Tokens.Content);

    await expect(
      content.defineType({ slug: 'Bad_Slug', fields: [{ name: 'a', type: 'text' }] }, actor)
    ).rejects.toThrow(/slug/);
    await expect(
      content.defineType({ slug: 'ok', fields: [{ name: 'status', type: 'text' }] }, actor)
    ).rejects.toThrow(/保留键/);
    await expect(
      content.defineType({ slug: 'ok2', fields: [{ name: 's', type: 'select' }] }, actor)
    ).rejects.toThrow(/options/);
    await app.stop();
  });

  it('数据写入校验使用动态定义的字段（未知字段拒绝对新类型同样生效）', async () => {
    const app = await createBlogApp({ dialect: 'sqlite', url: ':memory:', tenantId: 'tenant01' });
    const content = app.registry.require<ContentService>(Tokens.Content);
    await content.defineType(pageType, actor);

    await expect(
      content.create({
        type: 'pages',
        tenantId: 'tenant01',
        data: { title: 't', pririty: 1 }, // 拼错字段名
        actor: { id: 'u', tenantId: 'tenant01', kind: 'user' },
      })
    ).rejects.toThrow(/未在类型/);
    await app.stop();
  });

  it('跨重启持久化：新实例（同文件库）能解析动态定义的类型', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cms-types-'));
    const db = join(dir, 'app.db');
    try {
      const app1 = await createBlogApp({ dialect: 'sqlite', url: db, tenantId: 'tenant01' });
      await app1.registry
        .require<ContentService>(Tokens.Content)
        .defineType(pageType, actor);
      await app1.stop();

      const app2 = await createBlogApp({ dialect: 'sqlite', url: db, tenantId: 'tenant01' });
      const content2 = app2.registry.require<ContentService>(Tokens.Content);
      expect(await content2.getType('pages', 'tenant01')).not.toBeNull();
      const entry = await content2.create({
        type: 'pages',
        tenantId: 'tenant01',
        data: { title: '重启后创建', body: [] },
        actor: { id: 'u', tenantId: 'tenant01', kind: 'user' },
      });
      expect(entry.id).toBeTruthy();
      await app2.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('类型管理 API（Management）', () => {
  it('POST /types 定义 → GET /types 列表 → 用新类型创建条目', async () => {
    const app = await createBlogApp({
      dialect: 'sqlite',
      url: ':memory:',
      tenantId: 'tenant01',
      http: { guard: allowAllGuard(), tenantId: 'tenant01' },
    });
    const api = app.registry.require<HttpApp>(HttpTokens.App);
    const headers = { 'content-type': 'application/json' };

    const def = await api.request('/api/manage/v1/types', {
      method: 'POST',
      body: JSON.stringify(pageType),
      headers,
    });
    expect(def.status).toBe(201);

    const list = await api.request('/api/manage/v1/types');
    const items = ((await list.json()) as { items: { slug: string }[] }).items;
    expect(items.map((i) => i.slug)).toContain('pages');

    const entry = await api.request('/api/manage/v1/pages', {
      method: 'POST',
      body: JSON.stringify({ title: 't', body: [] }),
      headers,
    });
    expect(entry.status).toBe(201);
    await app.stop();
  });

  it('非法定义 → 400 且错误码为 E_VALIDATION', async () => {
    const app = await createBlogApp({
      dialect: 'sqlite',
      url: ':memory:',
      tenantId: 'tenant01',
      http: { guard: allowAllGuard(), tenantId: 'tenant01' },
    });
    const api = app.registry.require<HttpApp>(HttpTokens.App);
    const res = await api.request('/api/manage/v1/types', {
      method: 'POST',
      body: JSON.stringify({ slug: 'bad', fields: [{ name: 's', type: 'select' }] }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('E_VALIDATION');
    await app.stop();
  });
});
