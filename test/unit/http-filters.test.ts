// test/unit/http-filters.test.ts
// 查询参数 → QueryFilter 解析（决策 #26 的 API 形态）。

import { describe, it, expect } from 'vitest';
import { parseFilters } from '@modules/http/internal/filters.js';

describe('parseFilters', () => {
  it('基础操作符与类型推断（数字/布尔）', () => {
    const { filters, errors } = parseFilters({
      'filter[price][gte]': '100',
      'filter[published][eq]': 'true',
      'filter[title][contains]': 'hello',
    });
    expect(errors).toEqual([]);
    expect(filters).toEqual([
      { field: 'price', op: 'gte', value: 100 },
      { field: 'published', op: 'eq', value: true },
      { field: 'title', op: 'contains', value: 'hello' },
    ]);
  });

  it('JSON 字段点路径 + in 逗号数组 + contains 数组', () => {
    const { filters, errors } = parseFilters({
      'filter[data.price][lt]': '9.9',
      'filter[status][in]': 'draft,published',
      'filter[data.tags][contains]': 'hot,cold',
    });
    expect(errors).toEqual([]);
    expect(filters).toEqual([
      { field: 'data.price', op: 'lt', value: 9.9 },
      { field: 'status', op: 'in', value: ['draft', 'published'] },
      { field: 'data.tags', op: 'contains', value: ['hot', 'cold'] },
    ]);
  });

  it('非法字段路径 / 非法操作符 → errors（不静默忽略）', () => {
    const r1 = parseFilters({ 'filter[bad field][eq]': 'x' });
    expect(r1.errors[0]).toContain('非法字段路径');
    const r2 = parseFilters({ 'filter[price][between]': '1' });
    expect(r2.errors[0]).toContain('非法操作符');
    const r3 = parseFilters({ 'filter[price][eq]': "1; DROP TABLE" });
    expect(r3.errors).toEqual([]); // 值不作语法校验（驱动参数化绑定），仅结构校验
    expect(r3.filters[0]?.value).toBe('1; DROP TABLE');
  });

  it('非 filter 参数被忽略；空值忽略', () => {
    const { filters } = parseFilters({ limit: '10', 'filter[a][eq]': undefined });
    expect(filters).toEqual([]);
  });
});
