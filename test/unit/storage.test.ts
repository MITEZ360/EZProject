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

describe('sqlite 事务语义（契约 v1.1：可重入）', () => {
  it('嵌套 transaction() 不报错，内层操作随外层一起提交', async () => {
    await driver.transaction(async (tx) => {
      await tx.insert('entries', {
        id: 'n1', tenantId: 't', type: 'posts', locale: 'zh',
        status: 'draft', data: {}, createdAt: 1, updatedAt: 1, deletedAt: 0,
      });
      // 模块间组合的必然场景：事务内经过另一层服务再开事务
      await driver.transaction(async (tx2) => {
        await tx2.insert('entries', {
          id: 'n2', tenantId: 't', type: 'posts', locale: 'zh',
          status: 'draft', data: {}, createdAt: 2, updatedAt: 2, deletedAt: 0,
        });
      });
    });
    const rows = await driver.transaction((tx) => tx.find<{ id: string }>({ table: 'entries' }));
    expect(rows.map((r) => r.id).sort()).toEqual(['n1', 'n2']);
  });

  it('内层失败被外层捕获后，外层可选择继续并提交', async () => {
    await driver.transaction(async (tx) => {
      await tx.insert('entries', {
        id: 'keep', tenantId: 't', type: 'posts', locale: 'zh',
        status: 'draft', data: {}, createdAt: 1, updatedAt: 1, deletedAt: 0,
      });
      try {
        await driver.transaction(async (tx2) => {
          await tx2.insert('entries', {
            id: 'bad', tenantId: 't', type: 'posts', locale: 'zh',
            status: 'draft', data: {}, createdAt: 2, updatedAt: 2, deletedAt: 0,
          });
          throw new Error('内层业务错误');
        });
      } catch {
        /* 外层决定吞掉内层错误，继续事务 */
      }
    });
    const rows = await driver.transaction((tx) => tx.find<{ id: string }>({ table: 'entries' }));
    expect(rows.map((r) => r.id)).toEqual(['keep']); // bad 已随保存点回滚，keep 保留
  });

  it('外层失败整体回滚（含嵌套内的写入）', async () => {
    await expect(
      driver.transaction(async (tx) => {
        await tx.insert('entries', {
          id: 'r1', tenantId: 't', type: 'posts', locale: 'zh',
          status: 'draft', data: {}, createdAt: 1, updatedAt: 1, deletedAt: 0,
        });
        await driver.transaction(async (tx2) => {
          await tx2.insert('entries', {
            id: 'r2', tenantId: 't', type: 'posts', locale: 'zh',
            status: 'draft', data: {}, createdAt: 2, updatedAt: 2, deletedAt: 0,
          });
        });
        throw new Error('外层失败');
      })
    ).rejects.toThrow('外层失败');
    const rows = await driver.transaction((tx) => tx.find<{ id: string }>({ table: 'entries' }));
    expect(rows).toEqual([]);
  });
});

describe('sqlite 错误收敛与 count', () => {
  it('约束冲突收敛为 StorageError(E_CONFLICT)，不泄漏 SqliteError', async () => {
    const insert = () =>
      driver.transaction((tx) =>
        tx.insert('entries', {
          id: 'dup', tenantId: 't', type: 'posts', locale: 'zh',
          status: 'draft', data: {}, createdAt: 1, updatedAt: 1, deletedAt: 0,
        })
      );
    await insert();
    try {
      await insert();
      expect.unreachable('应抛出冲突错误');
    } catch (e) {
      expect((e as Error).name).toBe('E_CONFLICT');
      expect(String((e as Error).message)).not.toContain('SQLITE_'); // 方言错误码不外漏
    }
  });

  it('tx.count 统计行数（不取回数据）', async () => {
    for (let i = 1; i <= 5; i++) {
      await driver.transaction((tx) =>
        tx.insert('entries', {
          id: `c${i}`, tenantId: 't', type: i <= 3 ? 'posts' : 'pages', locale: 'zh',
          status: 'draft', data: {}, createdAt: i, updatedAt: i, deletedAt: 0,
        })
      );
    }
    const n = await driver.transaction((tx) =>
      tx.count({ table: 'entries', where: { tenantId: 't', type: 'posts' } })
    );
    expect(n).toBe(3);
  });

  it('未声明的表结构直接报错（禁止启发式 JSON 解析）', async () => {
    await expect(
      driver.transaction((tx) => tx.find({ table: 'unknown_table' } as never))
    ).rejects.toThrow('未声明的表结构');
  });
});

describe('策略工厂', () => {
  it('未实现的方言给出明确错误（而非静默失败）', () => {
    const pg: StorageConfig = { dialect: 'postgres' };
    expect(() => createStorageDriver(pg)).toThrow(/未实现/);
  });
});
