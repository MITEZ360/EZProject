// 声明式建表的 DDL 生成（方言无关）：列/主键/默认值/索引 → SQL 语句。
// 物理类型由驱动注入——这里只验证"声明怎么翻译成语句"，以及注入防护。
import { describe, it, expect } from 'vitest';
import { buildCreateTable } from '@modules/storage/schema/ddl.js';
import { StorageError } from '@modules/storage/schema/tables.js';
import type { PortableColumnType } from '@kernel/contracts/storage.contract.js';

/** 测试用的物理类型映射（模拟驱动注入） */
const PHYS: Record<PortableColumnType, string> = {
  text: 'TEXT',
  int: 'BIGINT',
  json: 'TEXT',
  timestamp: 'BIGINT',
  bool: 'BOOLEAN',
};
const pt = (t: PortableColumnType): string => PHYS[t];

describe('DDL 生成：列与约束', () => {
  it('列名加引号；主键与 NOT NULL 都落 NOT NULL', () => {
    const [sql] = buildCreateTable(
      {
        table: 't1',
        columns: [
          { name: 'id', type: 'text', primaryKey: true },
          { name: 'name', type: 'text', notNull: true },
          { name: 'note', type: 'text' },
        ],
      },
      pt
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "t1"');
    expect(sql).toContain('"id" TEXT NOT NULL');
    expect(sql).toContain('"name" TEXT NOT NULL');
    expect(sql).toContain('"note" TEXT');
    expect(sql).toContain('PRIMARY KEY ("id")');
  });

  it('物理类型来自注入（同一份声明可落不同方言）', () => {
    const def = {
      table: 't1',
      columns: [
        { name: 'ts', type: 'timestamp' as const },
        { name: 'flag', type: 'bool' as const },
      ],
    };
    const [sqlite] = buildCreateTable(def, (t) =>
      t === 'timestamp' ? 'INTEGER' : 'INTEGER'
    );
    const [pg] = buildCreateTable(def, (t) => (t === 'timestamp' ? 'BIGINT' : 'BOOLEAN'));
    expect(sqlite).toContain('"ts" INTEGER');
    expect(pg).toContain('"ts" BIGINT');
    expect(pg).toContain('"flag" BOOLEAN');
  });

  it('字面量默认值；字符串转义', () => {
    const [sql] = buildCreateTable(
      {
        table: 't1',
        columns: [
          { name: 'deleted_at', type: 'timestamp', notNull: true, default: 0 },
          { name: 'label', type: 'text', default: "it's" },
        ],
      },
      pt
    );
    expect(sql).toContain('"deleted_at" BIGINT NOT NULL DEFAULT 0');
    expect(sql).toContain(`"label" TEXT DEFAULT 'it''s'`);
  });

  it('复合主键走表级声明', () => {
    const [sql] = buildCreateTable(
      {
        table: 't1',
        columns: [
          { name: 'a', type: 'text', primaryKey: true },
          { name: 'b', type: 'text', primaryKey: true },
        ],
      },
      pt
    );
    expect(sql).toContain('PRIMARY KEY ("a", "b")');
  });
});

describe('DDL 生成：索引', () => {
  it('普通索引 / 唯一索引 / 降序列（前缀 -）', () => {
    const stmts = buildCreateTable(
      {
        table: 'audit_logs',
        columns: [{ name: 'tenant_id', type: 'text', notNull: true }],
        indexes: [
          { name: 'ix_time', columns: ['tenant_id', '-occurred_at'] },
          { name: 'ux_email', columns: ['tenant_id', 'email'], unique: true },
        ],
      },
      pt
    );
    expect(stmts).toHaveLength(3); // CREATE TABLE + 2 索引
    expect(stmts[1]).toBe(
      'CREATE INDEX IF NOT EXISTS "ix_time" ON "audit_logs" ("tenant_id", "occurred_at" DESC);'
    );
    expect(stmts[2]).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ux_email" ON "audit_logs" ("tenant_id", "email");'
    );
  });

  it('全部幂等（IF NOT EXISTS）——重复调用不报错', () => {
    const stmts = buildCreateTable(
      {
        table: 't1',
        columns: [{ name: 'id', type: 'text', primaryKey: true }],
        indexes: [{ name: 'ix', columns: ['id'] }],
      },
      pt
    );
    for (const s of stmts) expect(s).toContain('IF NOT EXISTS');
  });
});

describe('DDL 生成：拒绝非法声明（防注入 / 防方言语法外泄）', () => {
  const bad = (def: Parameters<typeof buildCreateTable>[0]): void => {
    expect(() => buildCreateTable(def, pt)).toThrow(StorageError);
  };

  it('非法表名 / 列名 / 索引名', () => {
    bad({ table: 'a; DROP TABLE x', columns: [{ name: 'id', type: 'text' }] });
    bad({ table: 't1', columns: [{ name: 'id" --', type: 'text' }] });
    bad({
      table: 't1',
      columns: [{ name: 'id', type: 'text' }],
      indexes: [{ name: 'ix; DROP', columns: ['id'] }],
    });
    bad({
      table: 't1',
      columns: [{ name: 'id', type: 'text' }],
      indexes: [{ name: 'ix', columns: ['a b'] }],
    });
  });

  it('空列声明 / 重复列名 / 空索引列 / 非法默认值', () => {
    bad({ table: 't1', columns: [] });
    bad({
      table: 't1',
      columns: [
        { name: 'id', type: 'text' },
        { name: 'id', type: 'text' },
      ],
    });
    bad({
      table: 't1',
      columns: [{ name: 'id', type: 'text' }],
      indexes: [{ name: 'ix', columns: [] }],
    });
    bad({ table: 't1', columns: [{ name: 'id', type: 'int', default: Number.NaN }] });
  });
});
