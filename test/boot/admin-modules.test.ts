// test/boot/admin-modules.test.ts
// 通用管理模块：audit（订阅 content 领域事件）+ settings（per-tenant KV）
// + HTTP 可选端点（模块存在才挂载——"模块贡献页面"的服务端形态）。

import { describe, it, expect } from 'vitest';
import type { Hono } from 'hono';
import type { App } from '@kernel/bootstrap.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { AuditService } from '@kernel/contracts/audit.contract.js';
import type { SettingsService } from '@kernel/contracts/settings.contract.js';
import { bootstrap } from '@kernel/bootstrap.js';
import { blogTypes } from '@scenarios/blog/index.js';
import { Tokens } from '@kernel/registry.js';
import { storageModule } from '@modules/storage/index.js';
import { contentModule } from '@modules/content/index.js';
import { httpModule, allowAllGuard, HttpTokens } from '@modules/http/index.js';
import { auditModule } from '@modules/audit/index.js';
import { settingsModule } from '@modules/settings/index.js';

const actor = { id: 'u1', tenantId: 'tenant01', kind: 'user' };

async function boot(withModules: boolean): Promise<App> {
  return bootstrap({
    modules: [
      storageModule({ dialect: 'sqlite', url: ':memory:' }),
      contentModule(blogTypes),
      httpModule({ guard: allowAllGuard(), tenantId: 'tenant01' }),
      ...(withModules ? [auditModule(), settingsModule()] : []),
    ],
  });
}

describe('audit 模块（事件订阅 → 私有表）', () => {
  it('content 的增/改/删都产生审计记录', async () => {
    const app = await boot(true);
    const content = app.registry.require<ContentService>(Tokens.Content);
    const audit = app.registry.require<AuditService>(Tokens.Audit);

    const e = await content.create({
      type: 'posts',
      tenantId: 'tenant01',
      data: { title: 't', body: [] },
      actor,
    });
    await content.update(e.id, { tenantId: 'tenant01', data: { title: 't2' }, actor });
    await content.remove(e.id, 'tenant01', actor);

    const logs = await audit.list({ tenantId: 'tenant01' });
    expect(logs.map((l) => l.event)).toEqual([
      'content.entry.deleted',
      'content.entry.updated',
      'content.entry.created',
    ]);
    expect(logs[0]?.actorId).toBe('u1');
    expect(logs[0]?.detail['id']).toBe(e.id);
    await app.stop();
  });

  it('按 event 过滤', async () => {
    const app = await boot(true);
    const content = app.registry.require<ContentService>(Tokens.Content);
    const audit = app.registry.require<AuditService>(Tokens.Audit);
    await content.create({ type: 'posts', tenantId: 'tenant01', data: { title: 'a', body: [] }, actor });
    await content.create({ type: 'posts', tenantId: 'tenant01', data: { title: 'b', body: [] }, actor });

    const created = await audit.list({ tenantId: 'tenant01', event: 'content.entry.created' });
    expect(created).toHaveLength(2);
    await app.stop();
  });
});

describe('settings 模块（per-tenant KV）', () => {
  it('set / get / list；值任意 JSON；租户隔离', async () => {
    const app = await boot(true);
    const settings = app.registry.require<SettingsService>(Tokens.Settings);

    await settings.set('tenant01', 'site.title', '我的站点');
    await settings.set('tenant01', 'site.features', ['a', 'b']);
    await settings.set('tenant02', 'site.title', '另一个租户');

    expect((await settings.get('tenant01', 'site.title'))?.value).toBe('我的站点');
    expect((await settings.get('tenant02', 'site.title'))?.value).toBe('另一个租户');
    expect((await settings.get('tenant01', 'site.features'))?.value).toEqual(['a', 'b']);
    expect(await settings.get('tenant01', 'nope')).toBeNull();

    const items = await settings.list('tenant01');
    expect(items.map((i) => i.key)).toEqual(['site.features', 'site.title']);
    await app.stop();
  });

  it('重复 set 覆盖（upsert）；非法键报错', async () => {
    const app = await boot(true);
    const settings = app.registry.require<SettingsService>(Tokens.Settings);
    await settings.set('t', 'k', 1);
    await settings.set('t', 'k', 2);
    expect((await settings.get('t', 'k'))?.value).toBe(2);

    await expect(settings.set('t', 'bad key!', 1)).rejects.toThrow(/非法设置键/);
    await app.stop();
  });
});

describe('HTTP 通用管理端点（模块存在才挂载）', () => {
  it('audit/settings 未加载 → 端点 404 JSON（不被吞）', async () => {
    const app = await boot(false);
    const api = app.registry.require<Hono>(HttpTokens.App);
    expect(app.registry.has(Tokens.Audit)).toBe(false);

    const res = await api.request('/api/manage/v1/audit-logs');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('E_NOT_FOUND');
    await app.stop();
  });

  it('audit/settings 已加载 → 端点可用（内容变更可见于审计端点；设置可写可读）', async () => {
    const app = await boot(true);
    const api = app.registry.require<Hono>(HttpTokens.App);
    const content = app.registry.require<ContentService>(Tokens.Content);

    await content.create({ type: 'posts', tenantId: 'tenant01', data: { title: 'x', body: [] }, actor });

    const logs = await api.request('/api/manage/v1/audit-logs?event=content.entry.created');
    expect(((await logs.json()) as { items: unknown[] }).items).toHaveLength(1);

    const put = await api.request('/api/manage/v1/settings/site.title', {
      method: 'PUT',
      body: JSON.stringify({ value: '通用 CMS' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(put.status).toBe(200);

    const list = await api.request('/api/manage/v1/settings');
    const items = (await list.json()) as { items: { key: string; value: unknown }[] };
    expect(items.items).toContainEqual({ key: 'site.title', value: '通用 CMS', updatedAt: expect.any(Number) });
    await app.stop();
  });

  it('非法设置键 → 400', async () => {
    const app = await boot(true);
    const api = app.registry.require<Hono>(HttpTokens.App);
    const res = await api.request('/api/manage/v1/settings/bad%20key', {
      method: 'PUT',
      body: JSON.stringify({ value: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
    await app.stop();
  });
});
