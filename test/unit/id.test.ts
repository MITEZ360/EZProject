import { describe, it, expect } from 'vitest';
import { newId, newTenantId, isValidTenantId, NOT_DELETED, isActive, markDeleted } from '@kernel/primitives/id.js';

describe('id primitives', () => {
  it('newId 返回 UUIDv7（版本位=7）', () => {
    const id = newId();
    // xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('newId 时间有序：跨毫秒后生成更大', async () => {
    const a = newId();
    await new Promise((r) => setTimeout(r, 5));
    const b = newId();
    expect(b >= a).toBe(true);
  });

  it('newId 同毫秒内单调递增（审计/排序 tie-break 依赖）', () => {
    // 同毫秒批量生成：字符串序必须等于生成顺序（rand_a 序号递增保证）
    const ids = Array.from({ length: 200 }, () => newId());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    expect(new Set(ids).size).toBe(200); // 且不重复
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
