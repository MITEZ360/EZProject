import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import { createStorageDriver, type StorageConfig } from '@modules/storage/factory.js';

let driver: StorageDriver;

beforeEach(async () => {
  driver = createStorageDriver({ dialect: 'sqlite', url: ':memory:' });
  await driver.migrate();
});

afterEach(async () => {
  await driver.close();
});

describe('sqlite 驱动（实现 StorageDriver 契约）', () => {
  it('dialect 正确', () => {
    expect(driver.dialect).toBe('sqlite');
  });

  it('insert / findOne / find 往返（JSON 字段自动序列化）', async () => {
    await driver.transaction(async (tx) => {
      await tx.insert('entries', {
        id: 'e1',
        tenantId: 'tenant01',
        type: 'posts',
        locale: 'zh',
        status: 'draft',
        data: { title: '你好', body: [{ _type: 'block', _key: 'k1', style: 'normal', children: [] }] },
        createdAt: 1,
        updatedAt: 1,
        deletedAt: 0,
      });
    });

    await driver.transaction(async (tx) => {
      const row = await tx.findOne<{ id: string; data: { title: string }; tenantId: string }>({
        table: 'entries',
        where: { id: 'e1' },
      });
      expect(row?.id).toBe('e1');
      expect(row?.data.title).toBe('你好'); // JSON 已还原为对象
      expect(row?.tenantId).toBe('tenant01'); // 下划线 → camelCase
    });
  });

  it('update 局部字段', async () => {
    await driver.transaction((tx) =>
      tx.insert('entries', {
        id: 'e2', tenantId: 'tenant01', type: 'posts', locale: 'zh',
        status: 'draft', data: {}, createdAt: 1, updatedAt: 1, deletedAt: 0,
      })
    );
    await driver.transaction((tx) =>
      tx.update('entries', 'e2', { status: 'published', updatedAt: 99 })
    );
    const row = await driver.transaction((tx) =>
      tx.findOne<{ status: string; updatedAt: number }>({ table: 'entries', where: { id: 'e2' } })
    );
    expect(row?.status).toBe('published');
    expect(row?.updatedAt).toBe(99);
  });

  it('find 支持 where / orderBy / limit', async () => {
    for (let i = 1; i <= 3; i++) {
      await driver.transaction((tx) =>
        tx.insert('entries', {
          id: `e${i}`, tenantId: 't', type: 'posts', locale: 'zh',
          status: 'draft', data: {}, createdAt: i, updatedAt: i, deletedAt: 0,
        })
      );
    }
    const rows = await driver.transaction((tx) =>
      tx.find<{ id: string }>({
        table: 'entries',
        where: { tenantId: 't' },
        orderBy: [{ field: 'createdAt', dir: 'desc' }],
        limit: 2,
      })
    );
    expect(rows.map((r) => r.id)).toEqual(['e3', 'e2']);
  });

  it('活跃 slug 唯一索引：同租户同 slug 仅一条活跃行', async () => {
    const insertActive = (id: string) =>
      driver.transaction((tx) =>
        tx.insert('entries', {
          id, tenantId: 't', type: 'posts', slug: 'hello', locale: 'zh',
          status: 'draft', data: {}, createdAt: 1, updatedAt: 1, deletedAt: 0,
        })
      );

    await insertActive('a1');
    await expect(insertActive('a2')).rejects.toThrow();
  });

  it('软删除后可复用 slug（哨兵值法）', async () => {
    const insert = (id: string, deletedAt: number) =>
      driver.transaction((tx) =>
        tx.insert('entries', {
          id, tenantId: 't', type: 'posts', slug: 'hello', locale: 'zh',
          status: 'draft', data: {}, createdAt: 1, updatedAt: 1, deletedAt,
        })
      );
    await insert('a1', 0);              // 活跃
    await driver.transaction((tx) =>
      tx.update('entries', 'a1', { deletedAt: Date.now() }) // 软删除 a1
    );
    await insert('a2', 0);             // 复用 slug：应成功（a1 已非活跃）
    await expect(insert('a2-dup', 0)).rejects.toThrow(); // 两个活跃同 slug：应冲突
  });
});

describe('策略工厂', () => {
  it('未实现的方言给出明确错误（而非静默失败）', () => {
    const pg: StorageConfig = { dialect: 'postgres' };
    expect(() => createStorageDriver(pg)).toThrow(/未实现/);
  });
});
