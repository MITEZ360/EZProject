import { describe, it, expect } from 'vitest';
import { newId, newTenantId, isValidTenantId, NOT_DELETED, isActive, markDeleted } from '@kernel/primitives/id.js';

describe('id primitives', () => {
  it('newId 返回 UUIDv7（版本位=7）', () => {
    const id = newId();
    // xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('newId 时间有序：后生成的 id 字符串更大（同一毫秒内不保证，但跨毫秒成立）', async () => {
    const a = newId();
    await new Promise((r) => setTimeout(r, 5));
    const b = newId();
    // 前缀是时间戳，通常 b > a
    expect(b >= a).toBe(true);
  });

  it('newId 不重复', () => {
    const set = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(set.size).toBe(1000);
  });

  it('newTenantId 为 8 字符 base62', () => {
    const id = newTenantId();
    expect(id).toHaveLength(8);
    expect(isValidTenantId(id)).toBe(true);
  });

  it('isValidTenantId 拒绝非法值', () => {
    expect(isValidTenantId('short')).toBe(false);
    expect(isValidTenantId('has-dash')).toBe(false);
    expect(isValidTenantId('1234567')).toBe(false);
  });

  it('软删除哨兵值语义', () => {
    expect(NOT_DELETED).toBe(0);
    expect(isActive(0)).toBe(true);
    expect(isActive(Date.now())).toBe(false);
    expect(markDeleted().deletedAt).toBeGreaterThan(0);
  });
});
