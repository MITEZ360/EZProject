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

  it('同一逻辑类型在不同方言下映射到不同物理类型', () => {
    expect(column('json', 'data', 'sqlite').physical).toBe('TEXT');
    expect(column('json', 'data', 'postgres').physical).toBe('JSONB');
    expect(column('json', 'data', 'mysql').physical).toBe('JSON');
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
