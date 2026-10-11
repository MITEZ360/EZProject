import { describe, it, expect } from 'vitest';
import { bootstrap } from '@kernel/bootstrap.js';
import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import { storageModule } from '@modules/storage/index.js';
import { contentModule } from '@modules/content/index.js';
import { createBlogApp, blogTypes } from '@scenarios/blog/index.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import { Tokens } from '@kernel/registry.js';

// —— 架构分水岭 1：可拔插性 ——
describe('可拔插性：只加载子集也能启动', () => {
  it('仅 storage 模块可启动', async () => {
    const app = await bootstrap({
      modules: [storageModule({ dialect: 'sqlite', url: ':memory:' })],
    });
    expect(app.isReady()).toBe(true);
    expect(app.loadedModules()).toEqual(['storage']);
    await app.stop();
  });

  it('storage + content 可启动；content 自动先加载 storage（依赖拓扑）', async () => {
    const app = await bootstrap({
      modules: [
        contentModule(blogTypes), // 故意把 content 放前面
        storageModule({ dialect: 'sqlite', url: ':memory:' }),
      ],
    });
    expect(app.loadedModules()).toEqual(['storage', 'content']);
    await app.stop();
  });

  it('空模块集可启动（内核不依赖任何模块）', async () => {
    const app = await bootstrap({ modules: [] });
    expect(app.isReady()).toBe(true);
    await app.stop();
  });

  it('依赖缺失时报错（不会静默启动）', async () => {
    const orphan: PlatformModule = {
      name: 'orphan',
      dependsOn: ['not-there'],
      async setup() {},
    };
    await expect(bootstrap({ modules: [orphan] })).rejects.toThrow(/依赖缺失/);
  });
});

// —— 架构分水岭 2：切方言能生效 ——
describe('策略模式：切方言能生效', () => {
  it('sqlite 可实例化并注册进 registry', async () => {
    const app = await bootstrap({
      modules: [storageModule({ dialect: 'sqlite', url: ':memory:' })],
    });
    expect(app.registry.require<StorageDriver>(Tokens.Storage).dialect).toBe('sqlite');
    await app.stop();
  });

  it('未实现的方言给出明确错误', async () => {
    // postgres 已实现（见 test/boot/postgres-e2e.test.ts）；mysql 仍未实现
    await expect(
      bootstrap({ modules: [storageModule({ dialect: 'mysql' })] })
    ).rejects.toThrow(/未实现/);
  });
});

// —— 内容层铁律 ——
describe('内容层：存结构不存 HTML', () => {
  it('富文本写入的是 Portable Text 结构，不是 HTML 字符串', async () => {
    const app = await createBlogApp({ dialect: 'sqlite', url: ':memory:' });
    const content = app.registry.require<ContentService>(Tokens.Content);

    const entry = await content.create({
      type: 'posts',
      tenantId: 'tenant01',
      data: {
        title: '你好',
        slug: 'hello',
        body: [{ _type: 'block', _key: 'k1', style: 'normal', children: [{ _type: 'span', _key: 's1', text: 'hi' }] }],
      },
      actor: { id: 'u1', tenantId: 'tenant01', kind: 'user' },
    });

    expect(Array.isArray(entry.data['body'])).toBe(true);
    expect(typeof entry.data['body']).not.toBe('string');
    await app.stop();
  });

  it('存 HTML 字符串被拒绝（铁律）', async () => {
    const app = await createBlogApp({ dialect: 'sqlite', url: ':memory:' });
    const content = app.registry.require<ContentService>(Tokens.Content);

    await expect(
      content.create({
        type: 'posts',
        tenantId: 'tenant01',
        data: { title: 'x', slug: 'x', body: '<p>HTML</p>' },
        actor: { id: 'u1', tenantId: 'tenant01', kind: 'user' },
      })
    ).rejects.toThrow(/Portable Text|HTML/);
    await app.stop();
  });

  it('读写往返：创建的条目可查回', async () => {
    const app = await createBlogApp({ dialect: 'sqlite', url: ':memory:' });
    const content = app.registry.require<ContentService>(Tokens.Content);
    const created = await content.create({
      type: 'posts',
      tenantId: 'tenant01',
      data: { title: 't', slug: 's', body: [] },
      actor: { id: 'u1', tenantId: 'tenant01', kind: 'user' },
    });
    const found = await content.findOne(created.id, 'tenant01');
    expect(found?.id).toBe(created.id);
    expect(found?.data['title']).toBe('t');
    await app.stop();
  });

  it('方法解构后调用依然安全（不依赖 this）', async () => {
    const app = await createBlogApp({ dialect: 'sqlite', url: ':memory:' });
    const content = app.registry.require<ContentService>(Tokens.Content);
    const created = await content.create({
      type: 'posts',
      tenantId: 'tenant01',
      data: { title: 't', slug: 's', body: [] },
      actor: { id: 'u1', tenantId: 'tenant01', kind: 'user' },
    });
    const { update, remove, findOne } = content; // Hono handler 常见用法
    const updated = await update(created.id, {
      tenantId: 'tenant01',
      data: { title: 't2' },
      actor: { id: 'u1', tenantId: 'tenant01', kind: 'user' },
    });
    expect(updated.data['title']).toBe('t2');
    await remove(created.id, 'tenant01', { id: 'u1', tenantId: 'tenant01', kind: 'user' });
    expect(await findOne(created.id, 'tenant01')).toBeNull();
    await app.stop();
  });

  it('find 的 total 与 items 同视图：limit 截断时 total 不变', async () => {
    const app = await createBlogApp({ dialect: 'sqlite', url: ':memory:' });
    const content = app.registry.require<ContentService>(Tokens.Content);
    for (let i = 1; i <= 5; i++) {
      await content.create({
        type: 'posts',
        tenantId: 'tenant01',
        data: { title: `t${i}`, slug: `s${i}`, body: [] },
        actor: { id: 'u1', tenantId: 'tenant01', kind: 'user' },
      });
    }
    const page = await content.find({ tenantId: 'tenant01', type: 'posts', limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5); // 计数不被 limit 截断，且与 items 同一事务视图
    await app.stop();
  });
});
