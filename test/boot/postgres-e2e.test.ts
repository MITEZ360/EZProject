// PostgreSQL 端到端：验证「换配置可切库」在**应用层**成立（不只是驱动层）。
// 需真实 PG 服务——设 TEST_PG_URL 才跑（否则整个文件跳过）。
//
//   TEST_PG_URL=postgres://user:pass@host:5432/db npx vitest run --no-file-parallelism test/boot/postgres-e2e.test.ts
//
// 注：PG 测试需串行（多文件并行会争抢同一个库的建表/清表），Makefile 的 test-pg 已固化该参数。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootstrap, type App } from '@kernel/bootstrap.js';
import { Tokens } from '@kernel/registry.js';
import { storageModule } from '@modules/storage/index.js';
import { contentModule } from '@modules/content/index.js';
import { authzModule } from '@modules/authz/index.js';
import { settingsModule } from '@modules/settings/index.js';
import { createStorageDriver } from '@modules/storage/factory.js';
import { blogTypes } from '@scenarios/blog/index.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import type { EntityTypeDef } from '@kernel/primitives/entity.js';
import { systemPrincipal } from '@kernel/primitives/principal.js';

const PG = process.env['TEST_PG_URL'];
const TENANT = 'tenant01';
const actor = systemPrincipal(TENANT);

const DROP =
  'DROP TABLE IF EXISTS entries, content_types, auth_users, auth_roles, auth_refresh_tokens, settings, assets, audit_logs CASCADE';

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
  const content = (): ContentService => app.registry.require<ContentService>(Tokens.Content);

  beforeAll(async () => {
    const clean = createStorageDriver({ dialect: 'postgres', url: PG as string });
    await clean.transaction((tx) => tx.exec(DROP));
    await clean.close();

    app = await bootstrap({
      modules: [
        storageModule({ dialect: 'postgres', url: PG }),
        contentModule(blogTypes),
        authzModule({ jwtSecret: 'test-secret' }),
        settingsModule(),
      ],
      config: { tenantId: TENANT },
    });
  });

  afterAll(async () => {
    await app?.stop();
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
});
