// PostgreSQL 端到端：验证「换配置可切库」在**应用层**成立（不只是驱动层）。
// 需真实 PG 服务——设 TEST_PG_URL 才跑（否则整个文件跳过）。
//
//   TEST_PG_URL=postgres://user:pass@host:5432/db npx vitest run --no-file-parallelism test/boot/postgres-e2e.test.ts
//
// 注：PG 测试需串行（多文件并行会争抢同一个库的建表/清表），Makefile 的 test-pg 已固化该参数。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap, type App } from '@kernel/bootstrap.js';
import { Tokens } from '@kernel/registry.js';
import { storageModule } from '@modules/storage/index.js';
import { contentModule } from '@modules/content/index.js';
import { authzModule } from '@modules/authz/index.js';
import { settingsModule } from '@modules/settings/index.js';
import { mediaModule } from '@modules/media/index.js';
import { httpModule, HttpTokens, type HttpApp } from '@modules/http/index.js';
import { createStorageDriver } from '@modules/storage/factory.js';
import { blogTypes } from '@scenarios/blog/index.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import type { AssetStore } from '@kernel/contracts/asset.contract.js';
import type { SettingsService } from '@kernel/contracts/settings.contract.js';
import type { EntityTypeDef } from '@kernel/primitives/entity.js';
import { systemPrincipal } from '@kernel/primitives/principal.js';

const PG = process.env['TEST_PG_URL'];
const TENANT = 'tenant01';
const actor = systemPrincipal(TENANT);
const BOOTSTRAP_TOKEN = 'pg-bootstrap-token';

const DROP =
  'DROP TABLE IF EXISTS search_index, entries, content_types, auth_users, auth_roles, auth_refresh_tokens, settings, assets, audit_logs CASCADE';

const PT = (text: string): unknown[] => [
  { _type: 'block', _key: 'k1', style: 'normal', children: [{ _type: 'span', _key: 's1', text }], markDefs: [] },
];

const products: EntityTypeDef = {
  slug: 'products',
  fields: [
    { name: 'name', type: 'text' },
    { name: 'price', type: 'number' },
    { name: 'tags', type: 'select', options: ['hot', 'cold'], multiple: true },
  ],
};

describe.skipIf(!PG)('PostgreSQL 端到端（换配置可切库）', () => {
  let app: App;
  let mediaRoot: string;
  const content = (): ContentService => app.registry.require<ContentService>(Tokens.Content);

  beforeAll(async () => {
    mediaRoot = mkdtempSync(join(tmpdir(), 'cms-pg-media-'));
    const clean = createStorageDriver({ dialect: 'postgres', url: PG as string });
    await clean.transaction((tx) => tx.exec(DROP));
    await clean.close();

    app = await bootstrap({
      modules: [
        storageModule({ dialect: 'postgres', url: PG }),
        contentModule(blogTypes),
        authzModule({ jwtSecret: 'test-secret' }),
        settingsModule(),
        mediaModule({ root: mediaRoot }),
        httpModule({ tenantId: TENANT, manageToken: BOOTSTRAP_TOKEN }),
      ],
      config: { tenantId: TENANT },
    });
  });

  afterAll(async () => {
    await app?.stop();
    if (mediaRoot) rmSync(mediaRoot, { recursive: true, force: true });
  });

  it('装配成功：方言为 postgres，内建类型已种子落库', async () => {
    expect(app.loadedModules()).toContain('content');
    const types = await content().listTypes(TENANT);
    expect(types.map((t) => t.slug)).toContain('posts');
  });

  it('内容 CRUD 往返：PT 结构原样存取（JSON 列跨方言不损坏）', async () => {
    const created = await content().create({
      type: 'posts',
      tenantId: TENANT,
      data: { title: 'PG 上的文章', slug: 'pg-1', body: PT('正文内容'), featured: true },
      actor,
    });
    const found = await content().findOne(created.id, TENANT);
    expect(found?.data['title']).toBe('PG 上的文章');
    expect(found?.data['featured']).toBe(true); // 布尔跨方言
    expect(Array.isArray(found?.data['body'])).toBe(true);
    expect(typeof created.createdAt).toBe('number'); // epoch 毫秒（bigint → number）

    const updated = await content().update(created.id, {
      tenantId: TENANT,
      data: { title: '改名后' },
      actor,
    });
    expect(updated.data['title']).toBe('改名后');
  });

  it('JSON 数字范围过滤：不按字典序（PG 上最容易错的地方）', async () => {
    await content().defineType(products, actor);
    const mk = (slug: string, price: number, tags: string[]): Promise<unknown> =>
      content().create({
        type: 'products',
        tenantId: TENANT,
        data: { name: slug, slug, price, tags },
        actor,
      });
    await mk('n9', 9, ['cold']);
    await mk('n10', 10, ['hot']);
    await mk('n100', 100, ['hot', 'cold']);

    // >= 10 必须只命中 10 / 100 —— 若驱动漏了 cast，9 也会被算进来（'9' > '1'）
    const page = await content().find({
      type: 'products',
      tenantId: TENANT,
      filters: [{ field: 'data.price', op: 'gte', value: 10 }],
      limit: 10,
    });
    expect(page.items.map((i) => i.data['name']).sort()).toEqual(['n10', 'n100']); // 不含 n9

    // 数组包含
    const hot = await content().find({
      type: 'products',
      tenantId: TENANT,
      filters: [{ field: 'data.tags', op: 'contains', value: ['hot'] }],
      limit: 10,
    });
    expect(hot.total).toBe(2);
  });

  it('软删除 + slug 复用（唯一约束哨兵值法跨方言一致）', async () => {
    const first = await content().create({
      type: 'posts',
      tenantId: TENANT,
      data: { title: '待删', slug: 'reusable', body: PT('x') },
      actor,
    });
    await content().remove(first.id, TENANT, actor);

    // 软删后同 slug 可复用
    const second = await content().create({
      type: 'posts',
      tenantId: TENANT,
      data: { title: '复用', slug: 'reusable', body: PT('y') },
      actor,
    });
    expect(second.id).not.toBe(first.id);

    // 两个活跃同 slug 应冲突（收敛为 E_CONFLICT，不泄漏 PG 错误码）
    await expect(
      content().create({
        type: 'posts',
        tenantId: TENANT,
        data: { title: '冲突', slug: 'reusable', body: PT('z') },
        actor,
      })
    ).rejects.toMatchObject({ name: 'E_CONFLICT' });
  });

  it('事务重入：嵌套事务回滚不影响外层提交', async () => {
    const driver = app.registry.require<StorageDriver>(Tokens.Storage);
    await driver.transaction(async (tx) => {
      await tx.insert('content_types', {
        id: 'pg-nested-1',
        tenantId: TENANT,
        slug: 'nested-a',
        schema: { slug: 'nested-a', fields: [] },
        createdAt: 1,
        updatedAt: 1,
      });
      // 内层失败：只回滚内层
      await driver
        .transaction(async (inner) => {
          await inner.insert('content_types', {
            id: 'pg-nested-2',
            tenantId: TENANT,
            slug: 'nested-b',
            schema: { slug: 'nested-b', fields: [] },
            createdAt: 1,
            updatedAt: 1,
          });
          throw new Error('内层故意失败');
        })
        .catch(() => undefined);
    });

    const rows = await driver.transaction((tx) =>
      tx.query<{ id: string }>('SELECT id FROM content_types WHERE id LIKE $1 ORDER BY id', ['pg-nested-%'])
    );
    expect(rows.map((r) => r.id)).toEqual(['pg-nested-1']); // 外层提交，内层回滚
  });

  // ---------- 模块私有表：PG 下真实读写 ----------
  // 这几张表曾是"硬编码 SQLite 物理类型"的重灾区：
  //   INTEGER 在 SQLite 是 64 位（动态类型），在 PG 只有 32 位 → epoch 毫秒溢出；
  //   布尔列直接把 JS boolean 交给整数列，PG 强类型会拒绝。
  // 这些缺陷**只在 PG 上暴露**——SQLite 侧的测试永远发现不了，故必须在此显式覆盖。

  it('authz 全链路：引导 → 登录 → 刷新（BIGINT 时间戳 / 布尔 0/1 落库）', async () => {
    const api = app.registry.require<HttpApp>(HttpTokens.App);
    const json = { 'content-type': 'application/json' };

    // 建管理员：写 auth_users(created_at/updated_at BIGINT) + auth_roles(builtin 0/1)
    const b = await api.request('/api/manage/v1/auth/bootstrap', {
      method: 'POST',
      headers: { ...json, authorization: `Bearer ${BOOTSTRAP_TOKEN}` },
      body: JSON.stringify({ email: 'pg-admin@example.com', password: 'secret-password', name: '管理员' }),
    });
    expect(b.status).toBe(201);

    // 登录：读回角色 builtin（PG 返回 0/1 数字，须能正确转回 boolean）
    const l = await api.request('/api/manage/v1/auth/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'pg-admin@example.com', password: 'secret-password' }),
    });
    expect(l.status).toBe(200);
    const pair = (await l.json()) as { accessToken: string; refreshToken: string };
    expect(pair.accessToken.split('.')).toHaveLength(3);

    // 刷新：写 auth_refresh_tokens(expires_at/revoked_at/created_at BIGINT)
    const r = await api.request('/api/manage/v1/auth/refresh', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ refreshToken: pair.refreshToken }),
    });
    expect(r.status).toBe(200);
    const rotated = (await r.json()) as { refreshToken: string };
    expect(rotated.refreshToken).not.toBe(pair.refreshToken); // 轮换
  });

  it('settings：PG 上读写（updated_at BIGINT）', async () => {
    const settings = app.registry.require<SettingsService>(Tokens.Settings);
    await settings.set(TENANT, 'pg.title', 'PG 站点');
    await settings.set(TENANT, 'pg.list', ['a', 'b']);

    expect((await settings.get(TENANT, 'pg.title'))?.value).toBe('PG 站点');
    expect((await settings.get(TENANT, 'pg.list'))?.value).toEqual(['a', 'b']);
    // 读回的 updatedAt 必须是完整 epoch 毫秒（截断成 32 位会得到 1970 年附近的数）
    expect((await settings.get(TENANT, 'pg.title'))?.updatedAt).toBeGreaterThan(1_600_000_000_000);
  });

  it('media：PG 上登记资产（size / created_at BIGINT）', async () => {
    const assets = app.registry.require<AssetStore>(Tokens.Assets);
    const data = new Uint8Array([1, 2, 3, 4, 5]);

    await assets.put({
      id: 'pg-asset-1',
      tenantId: TENANT,
      filename: 'a.bin',
      contentType: 'application/octet-stream',
      data,
    });

    const meta = await assets.getMeta('pg-asset-1', TENANT);
    expect(meta?.size).toBe(5);
    expect(meta?.createdAt).toBeGreaterThan(1_600_000_000_000);

    const got = await assets.read('pg-asset-1', TENANT);
    expect(Array.from(got!.data)).toEqual([1, 2, 3, 4, 5]);
  });
});
