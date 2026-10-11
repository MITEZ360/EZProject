// test/boot/revision-schedule.test.ts
// 两个通用能力模块：
//   revision  —— 订阅内容事件留快照，支持查看与回滚
//   scheduler —— 轮询到期计划，把条目置为已发布
// 走真实 bootstrap；scheduler 用 20ms 轮询间隔以便在测试里观察触发。

import { describe, it, expect, afterEach } from 'vitest';
import { bootstrap, type App } from '@kernel/bootstrap.js';
import { Tokens } from '@kernel/registry.js';
import { storageModule } from '@modules/storage/index.js';
import { contentModule } from '@modules/content/index.js';
import { revisionModule } from '@modules/revision/index.js';
import { schedulerModule } from '@modules/scheduler/index.js';
import { httpModule, HttpTokens, allowAllGuard, type HttpApp } from '@modules/http/index.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { RevisionService } from '@kernel/contracts/revision.contract.js';
import type { ScheduleService } from '@kernel/contracts/schedule.contract.js';
import type { EntityTypeDef } from '@kernel/primitives/entity.js';

const TENANT = 'tenant01';
const actor = { id: 'u1', tenantId: TENANT, kind: 'user' };

const types: EntityTypeDef[] = [
  {
    slug: 'posts',
    fields: [
      { name: 'title', type: 'text' },
      { name: 'body', type: 'longText' },
    ],
  },
];

let app: App;
let api: HttpApp;

async function boot(): Promise<void> {
  app = await bootstrap({
    modules: [
      storageModule({ dialect: 'sqlite', url: ':memory:' }),
      contentModule(types),
      revisionModule(),
      schedulerModule({ intervalMs: 20 }),
      httpModule({ tenantId: TENANT, guard: allowAllGuard(), manageToken: 'tk' }),
    ],
    config: { tenantId: TENANT },
  });
  api = app.registry.require<HttpApp>(HttpTokens.App);
}

const content = (): ContentService => app.registry.require<ContentService>(Tokens.Content);
const revisions = (): RevisionService => app.registry.require<RevisionService>(Tokens.Revision);
const schedules = (): ScheduleService => app.registry.require<ScheduleService>(Tokens.Schedule);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  await app?.stop();
});

describe('版本历史（revision）', () => {
  it('创建与更新各留一份快照，版本号递增', async () => {
    await boot();
    const e = await content().create({
      type: 'posts',
      tenantId: TENANT,
      data: { title: 'v1', slug: 'a' },
      actor,
    });
    await content().update(e.id, { tenantId: TENANT, data: { title: 'v2' }, actor });

    const list = await revisions().list(e.id, TENANT);
    expect(list.map((r) => r.version)).toEqual([2, 1]); // 新 → 旧
    expect(list[1]?.snapshot['title']).toBe('v1');
    expect(list[0]?.snapshot['title']).toBe('v2');
  });

  it('回滚：内容与顶层列都恢复，且回滚本身产生新版本（历史只增不减）', async () => {
    await boot();
    const e = await content().create({
      type: 'posts',
      tenantId: TENANT,
      data: { title: '原始', slug: 'a' },
      actor,
    });
    await content().update(e.id, { tenantId: TENANT, data: { title: '改坏了' }, actor });

    const back = await revisions().rollback(e.id, TENANT, 1, actor);
    expect(back.data['title']).toBe('原始');
    expect(back.slug).toBe('a'); // slug 是顶层列，同样要恢复

    const list = await revisions().list(e.id, TENANT);
    expect(list[0]?.version).toBe(3); // 回滚写回自己也留痕
    expect(list[0]?.snapshot['title']).toBe('原始');
  });

  it('回滚不存在的版本 → 明确报错', async () => {
    await boot();
    const e = await content().create({ type: 'posts', tenantId: TENANT, data: { title: 'x' }, actor });
    await expect(revisions().rollback(e.id, TENANT, 99, actor)).rejects.toThrow(/版本不存在/);
  });

  it('maxPerEntry 生效：超限裁掉最旧版本', async () => {
    app = await bootstrap({
      modules: [
        storageModule({ dialect: 'sqlite', url: ':memory:' }),
        contentModule(types),
        revisionModule({ maxPerEntry: 2 }),
      ],
      config: { tenantId: TENANT },
    });
    const e = await content().create({ type: 'posts', tenantId: TENANT, data: { title: '1' }, actor });
    await content().update(e.id, { tenantId: TENANT, data: { title: '2' }, actor });
    await content().update(e.id, { tenantId: TENANT, data: { title: '3' }, actor });

    const list = await revisions().list(e.id, TENANT);
    expect(list.map((r) => r.version)).toEqual([3, 2]); // v1 已被裁掉
  });

  it('不同条目的历史互不干扰', async () => {
    await boot();
    const a = await content().create({ type: 'posts', tenantId: TENANT, data: { title: 'A' }, actor });
    const b = await content().create({ type: 'posts', tenantId: TENANT, data: { title: 'B' }, actor });
    expect((await revisions().list(a.id, TENANT)).length).toBe(1);
    expect((await revisions().list(b.id, TENANT)).length).toBe(1);
    expect((await revisions().list(a.id, TENANT))[0]?.snapshot['title']).toBe('A');
  });
});

describe('定时发布（scheduler）', () => {
  it('到点后自动置为已发布，并清理计划', async () => {
    await boot();
    const e = await content().create({
      type: 'posts',
      tenantId: TENANT,
      data: { title: '定时', slug: 'later' },
      actor,
    });
    expect(e.status).toBe('draft');

    await schedules().schedule({
      entryId: e.id,
      tenantId: TENANT,
      type: 'posts',
      publishAt: Date.now() + 60,
    });
    expect((await schedules().list(TENANT)).length).toBe(1);

    await sleep(400); // intervalMs=20，足够跑多轮
    expect((await content().findOne(e.id, TENANT))?.status).toBe('published');
    expect((await schedules().list(TENANT)).length).toBe(0);
  });

  it('同一条目重复设定：覆盖而非堆积', async () => {
    await boot();
    const e = await content().create({ type: 'posts', tenantId: TENANT, data: { title: 'x' }, actor });
    await schedules().schedule({
      entryId: e.id,
      tenantId: TENANT,
      type: 'posts',
      publishAt: Date.now() + 60_000,
    });
    await schedules().schedule({
      entryId: e.id,
      tenantId: TENANT,
      type: 'posts',
      publishAt: Date.now() + 120_000,
    });
    const list = await schedules().list(TENANT);
    expect(list.length).toBe(1);
    expect(list[0]?.publishAt).toBeGreaterThan(Date.now() + 100_000);
  });

  it('目标条目已删除：到期也不报错，计划照样清理（不卡死重试）', async () => {
    await boot();
    const e = await content().create({ type: 'posts', tenantId: TENANT, data: { title: 'x' }, actor });
    await schedules().schedule({
      entryId: e.id,
      tenantId: TENANT,
      type: 'posts',
      publishAt: Date.now() + 40,
    });
    await content().remove(e.id, TENANT, actor);

    await sleep(400);
    expect(await schedules().get(e.id, TENANT)).toBeNull();

    await schedules().cancel(e.id, TENANT); // 无计划时静默
    expect((await schedules().list(TENANT)).length).toBe(0);
  });
});

describe('HTTP 端点', () => {
  it('未装模块 → 404（能力未挂载，不被 /:type 通配吞掉）', async () => {
    app = await bootstrap({
      modules: [
        storageModule({ dialect: 'sqlite', url: ':memory:' }),
        contentModule(types),
        httpModule({ tenantId: TENANT, guard: allowAllGuard(), manageToken: 'tk' }),
      ],
      config: { tenantId: TENANT },
    });
    const bare = app.registry.require<HttpApp>(HttpTokens.App);
    expect((await bare.request('/api/manage/v1/revisions/posts/x')).status).toBe(404);
    expect((await bare.request('/api/manage/v1/schedules')).status).toBe(404);
  });

  it('装了则可用：列历史 / 设定计划 / 列出 / 取消', async () => {
    await boot();
    const e = await content().create({
      type: 'posts',
      tenantId: TENANT,
      data: { title: '接口', slug: 'api-e' },
      actor,
    });

    const revs = await api.request(`/api/manage/v1/revisions/posts/${e.id}`);
    expect(revs.status).toBe(200);
    expect(((await revs.json()) as { items: unknown[] }).items.length).toBe(1);

    const put = await api.request(`/api/manage/v1/schedules/posts/${e.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publishAt: Date.now() + 60_000 }),
    });
    expect(put.status).toBe(200);

    const listed = await api.request('/api/manage/v1/schedules');
    expect(((await listed.json()) as { items: unknown[] }).items.length).toBe(1);

    const del = await api.request(`/api/manage/v1/schedules/posts/${e.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const after = await api.request('/api/manage/v1/schedules');
    expect(((await after.json()) as { items: unknown[] }).items.length).toBe(0);
  });

  it('publishAt 非法 → 400；版本号非法 → 400', async () => {
    await boot();
    const e = await content().create({ type: 'posts', tenantId: TENANT, data: { title: 'x' }, actor });

    const badAt = await api.request(`/api/manage/v1/schedules/posts/${e.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publishAt: 'not-a-number' }),
    });
    expect(badAt.status).toBe(400);

    const badVer = await api.request(`/api/manage/v1/revisions/posts/${e.id}/rollback/abc`, {
      method: 'POST',
    });
    expect(badVer.status).toBe(400);
  });

  it('回滚端点：内容真的回到旧版本', async () => {
    await boot();
    const e = await content().create({
      type: 'posts',
      tenantId: TENANT,
      data: { title: '初版', slug: 'rb' },
      actor,
    });
    await content().update(e.id, { tenantId: TENANT, data: { title: '第二版' }, actor });

    const res = await api.request(`/api/manage/v1/revisions/posts/${e.id}/rollback/1`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { title: string } }).data.title).toBe('初版');
  });
});
