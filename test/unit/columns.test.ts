import { describe, it, expect } from 'vitest';
import { column, strategies, type LogicalType, type Dialect } from '@modules/storage/schema/columns.js';

const TYPES: LogicalType[] = ['uuid', 'shortId', 'text', 'int', 'json', 'timestamp', 'bool'];
const DIALECTS: Dialect[] = ['sqlite', 'postgres', 'mysql'];

describe('策略表（columns）', () => {
  it('每个逻辑类型 × 每个方言都有策略（无缺失，消灭 if/else 的前提）', () => {
    for (const t of TYPES) {
      for (const d of DIALECTS) {
        expect(strategies[t][d], `${t} × ${d}`).toBeTypeOf('function');
      }
    }
  });

  it('同一逻辑类型在各方言下映射到该方言的物理类型', () => {
    // json：三方言都落文本类。PG 用 TEXT 而非 JSONB——与驱动内置表（entries.data）
    // 及值编解码路径（写入 stringify / 读出 parse）保持一致。
    expect(column('json', 'data', 'sqlite').physical).toBe('TEXT');
    expect(column('json', 'data', 'postgres').physical).toBe('TEXT');
    expect(column('json', 'data', 'mysql').physical).toBe('JSON');
  });

  it('时间戳在 PG 必须是 BIGINT——INTEGER 装不下 epoch 毫秒', () => {
    // 这条断言防的是一类真实事故：模块私有表曾硬编码 INTEGER，
    // SQLite（64 位动态类型）无感，PG（32 位）直接 out of range。
    expect(column('timestamp', 't', 'postgres').physical).toBe('BIGINT');
    expect(column('timestamp', 't', 'sqlite').physical).toBe('INTEGER');
    expect(column('int', 'n', 'postgres').physical).toBe('BIGINT');
  });

  it('时间统一 epoch 毫秒整数（跨方言）', () => {
    for (const d of DIALECTS) {
      expect(column('timestamp', 'created_at', d).physical).toMatch(/INTEGER|BIGINT/);
      expect(column('timestamp', 'created_at', d).jsonEncoded).toBe(false);
    }
  });

  it('json 标记需应用层序列化', () => {
    expect(column('json', 'data', 'postgres').jsonEncoded).toBe(true);
    expect(column('text', 'title', 'postgres').jsonEncoded).toBe(false);
  });
});
