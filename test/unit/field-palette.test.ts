// test/unit/field-palette.test.ts
// 决策 #26 字段类型集：11 种调色板 + 通用选项 + component 递归 + 未知字段拒绝。

import { describe, it, expect } from 'vitest';
import { validateEntityData } from '@modules/content/internal/validate.js';
import type { EntityTypeDef, FieldDef } from '@kernel/primitives/entity.js';

const def = (fields: FieldDef[]): EntityTypeDef => ({ slug: 't', fields });

const PT = [{ _type: 'block', _key: 'k1', style: 'normal', children: [{ _type: 'span', _key: 's1', text: 'hi' }] }];

describe('基础标量', () => {
  it('text：类型 / pattern / 长度范围（pattern 优先于 range）', () => {
    const d = def([{ name: 'code', type: 'text', pattern: '^[A-Z]{3}$', min: 3, max: 3 }]);
    expect(validateEntityData(d, { code: 'ABC' }).ok).toBe(true);
    expect(validateEntityData(d, { code: 'abc' }).issues[0]?.message).toContain('不匹配格式');
    expect(validateEntityData(d, { code: 'ABCD' }).issues[0]?.message).toContain('不匹配格式');
    expect(validateEntityData(d, { code: 1 }).issues[0]?.message).toBe('应为字符串');
    const rangeOnly = def([{ name: 'code', type: 'text', min: 3, max: 3 }]);
    expect(validateEntityData(rangeOnly, { code: 'AB' }).issues[0]?.message).toContain('不能小于');
  });

  it('longText：长度范围', () => {
    const d = def([{ name: 'bio', type: 'longText', max: 5 }]);
    expect(validateEntityData(d, { bio: '短' }).ok).toBe(true);
    expect(validateEntityData(d, { bio: '太长太长太长' }).issues[0]?.message).toContain('不能大于');
  });

  it('number：类型 / integer / 范围', () => {
    const d = def([{ name: 'age', type: 'number', integer: true, min: 0, max: 150 }]);
    expect(validateEntityData(d, { age: 18 }).ok).toBe(true);
    expect(validateEntityData(d, { age: 1.5 }).issues[0]?.message).toBe('应为整数');
    expect(validateEntityData(d, { age: 200 }).issues[0]?.message).toContain('不能大于');
    expect(validateEntityData(d, { age: 'x' }).issues[0]?.message).toBe('应为数字');
  });

  it('boolean：类型', () => {
    const d = def([{ name: 'on', type: 'boolean' }]);
    expect(validateEntityData(d, { on: true }).ok).toBe(true);
    expect(validateEntityData(d, { on: 'yes' }).issues[0]?.message).toBe('应为布尔');
  });

  it('date：epoch ms / dateOnly 必须 UTC 零点 / 范围', () => {
    const d = def([{ name: 'day', type: 'date', dateOnly: true, min: 0 }]);
    const noon = Date.UTC(2026, 0, 15, 12, 0, 0);
    const midnight = Date.UTC(2026, 0, 15);
    expect(validateEntityData(d, { day: midnight }).ok).toBe(true);
    expect(validateEntityData(d, { day: noon }).issues[0]?.message).toContain('UTC 零点');
    expect(validateEntityData(d, { day: '2026-01-15' }).issues[0]?.message).toContain('epoch');
    const ranged = def([{ name: 'day', type: 'date', min: 0 }]);
    expect(validateEntityData(ranged, { day: -1 }).issues[0]?.message).toContain('不能小于');
  });

  it('select：单选 / 多选 / options 必须声明', () => {
    const single = def([{ name: 'size', type: 'select', options: ['S', 'M', 'L'] }]);
    expect(validateEntityData(single, { size: 'M' }).ok).toBe(true);
    expect(validateEntityData(single, { size: 'XL' }).issues[0]?.message).toContain('不在选项内');

    const multi = def([{ name: 'tags', type: 'select', options: ['a', 'b'], multiple: true }]);
    expect(validateEntityData(multi, { tags: ['a', 'b'] }).ok).toBe(true);
    expect(validateEntityData(multi, { tags: ['a', 'x'] }).issues[0]?.message).toContain('x');

    const broken = def([{ name: 's', type: 'select' }]);
    expect(validateEntityData(broken, { s: 'x' }).issues[0]?.message).toContain('options');
  });
});

describe('结构类型', () => {
  it('richText：HTML 字符串被拒（铁律），PT 结构通过', () => {
    const d = def([{ name: 'body', type: 'richText' }]);
    expect(validateEntityData(d, { body: PT }).ok).toBe(true);
    expect(validateEntityData(d, { body: '<p>html</p>' }).issues[0]?.message).toContain('禁止存 HTML');
  });

  it('component 单值：递归校验子字段，多余键拒绝', () => {
    const d = def([
      {
        name: 'meta',
        type: 'component',
        fields: [
          { name: 'key', type: 'text', required: true },
          { name: 'value', type: 'text' },
        ],
      },
    ]);
    expect(validateEntityData(d, { meta: { key: 'k', value: 'v' } }).ok).toBe(true);
    const missing = validateEntityData(d, { meta: { value: 'v' } });
    expect(missing.issues[0]?.field).toBe('meta[0].key');
    expect(missing.issues[0]?.message).toBe('必填字段缺失');
    const extra = validateEntityData(d, { meta: { key: 'k', hack: 1 } });
    expect(extra.issues[0]?.message).toContain('未在 component 中定义');
  });

  it('component repeatable：数组逐项校验', () => {
    const d = def([
      {
        name: 'items',
        type: 'component',
        repeatable: true,
        fields: [{ name: 'n', type: 'number', integer: true }],
      },
    ]);
    expect(validateEntityData(d, { items: [{ n: 1 }, { n: 2 }] }).ok).toBe(true);
    expect(validateEntityData(d, { items: [{ n: 1.5 }] }).issues[0]?.field).toBe('items[0].n');
  });

  it('component 嵌套深度 >3 被拒', () => {
    const leaf: FieldDef = { name: 'v', type: 'text' };
    const l3: FieldDef = { name: 'l3', type: 'component', fields: [leaf] };
    const l2: FieldDef = { name: 'l2', type: 'component', fields: [l3] };
    const l1: FieldDef = { name: 'l1', type: 'component', fields: [l2] };
    const l4: FieldDef = { name: 'l4', type: 'component', fields: [l1] };
    const d = def([l4]);
    const okData = { l4: { l1: { l2: { l3: { v: 'x' } } } } };
    // l4(1) → l1(2) → l2(3) → l3(4>3) 超限
    expect(validateEntityData(d, okData).issues[0]?.message).toContain('嵌套超过');
  });
});

describe('引用与逃生舱', () => {
  it('relation / media：非空 ID 字符串', () => {
    const d = def([
      { name: 'author', type: 'relation', targetType: 'authors' },
      { name: 'cover', type: 'media' },
    ]);
    expect(validateEntityData(d, { author: 'e1', cover: 'a1' }).ok).toBe(true);
    expect(validateEntityData(d, { author: '' }).issues[0]?.message).toContain('非空');
    expect(validateEntityData(d, { cover: 123 }).issues[0]?.message).toContain('ID');
  });

  it('json：逃生舱不解释结构', () => {
    const d = def([{ name: 'extra', type: 'json' }]);
    expect(validateEntityData(d, { extra: { any: ['thing'] } }).ok).toBe(true);
    expect(validateEntityData(d, { extra: 'whatever' }).ok).toBe(true);
  });
});

describe('必填与未知字段', () => {
  it('required 缺失报错；非 required 缺失通过', () => {
    const d = def([
      { name: 'title', type: 'text', required: true },
      { name: 'note', type: 'text' },
    ]);
    const r = validateEntityData(d, {});
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([{ field: 'title', message: '必填字段缺失' }]);
  });

  it('未知字段拒绝；保留键 status/slug 放行（映射顶层物理列）', () => {
    const d = def([{ name: 'title', type: 'text' }]);
    const r = validateEntityData(d, { title: 't', typo: 1, status: 'draft', slug: 's' });
    expect(r.issues).toEqual([{ field: 'typo', message: '未在类型 "t" 中定义的字段' }]);
  });
});
