// 管理端字段值纯函数（lib/entry-format）：
// 通用 CMS 不写死业务字段——标题探测与空值构造都只看 FieldDef。
// 这几条逻辑是三个新编辑器（relation / component / media）的地基，故单独覆盖。
import { describe, it, expect } from 'vitest';
import {
  emptyComponentValue,
  emptyFieldValue,
  emptyFormValues,
  entryTitle,
  fillComponentItem,
  normalizeComponentValue,
} from '@scenarios/generic-cms/admin/src/lib/entry-format.js';
import type { FieldDef } from '@kernel/primitives/entity.js';

const F = (type: FieldDef['type'], extra: Partial<FieldDef> = {}): FieldDef => ({
  name: 'f',
  type,
  ...extra,
});

describe('entryTitle：标题探测（不写死业务字段）', () => {
  it('按 title → name → label 的优先级取第一个非空字符串', () => {
    expect(entryTitle({ id: 'a', data: { title: '标题甲' } })).toBe('标题甲');
    expect(entryTitle({ id: 'a', data: { name: '名字乙' } })).toBe('名字乙');
    expect(entryTitle({ id: 'a', data: { label: '标签丙' } })).toBe('标签丙');
    expect(entryTitle({ id: 'a', data: { name: '名字乙', title: '标题甲' } })).toBe('标题甲');
  });

  it('无标题字段时退回 slug，再退回 id 前缀', () => {
    expect(entryTitle({ id: 'a', slug: 'my-post', data: {} })).toBe('my-post');
    expect(entryTitle({ id: 'abcdefgh1234', data: {} })).toBe('abcdefgh');
  });

  it('空白字符串与非字符串不算标题（避免显示出空格或 "[object]"）', () => {
    expect(entryTitle({ id: 'abcdefgh1', slug: 's', data: { title: '   ' } })).toBe('s');
    expect(entryTitle({ id: 'abcdefgh1', data: { title: 42 } })).toBe('abcdefgh');
    expect(entryTitle({ id: 'abcdefgh1', data: { title: [] } })).toBe('abcdefgh');
  });

  it('data 缺失也不炸', () => {
    expect(entryTitle({ id: 'abcdefgh1' })).toBe('abcdefgh');
  });
});

describe('emptyFieldValue：按类型构造空值', () => {
  it('boolean → false（开关需要确定态，不能是 undefined）', () => {
    expect(emptyFieldValue(F('boolean'))).toBe(false);
  });

  it('select：多选 → []，单选 → undefined', () => {
    expect(emptyFieldValue(F('select', { multiple: true }))).toEqual([]);
    expect(emptyFieldValue(F('select'))).toBeUndefined();
  });

  it('component：repeatable → []，单实例 → 递归构造子字段', () => {
    const comp = F('component', {
      fields: [
        { name: 'text', type: 'text' },
        { name: 'ok', type: 'boolean' },
        { name: 'tags', type: 'select', multiple: true },
      ],
    });
    expect(emptyFieldValue({ ...comp, repeatable: true })).toEqual([]);
    expect(emptyFieldValue(comp)).toEqual({ ok: false, tags: [] });
  });

  it('标量与引用 → undefined', () => {
    for (const t of ['text', 'longText', 'number', 'date', 'richText', 'relation', 'media', 'json'] as const) {
      expect(emptyFieldValue(F(t))).toBeUndefined();
    }
  });
});

describe('normalizeComponentValue：存量数据容错', () => {
  const comp: FieldDef = {
    name: 'c',
    type: 'component',
    fields: [
      { name: 'a', type: 'text' },
      { name: 'b', type: 'boolean' },
    ],
  };

  it('单实例：补齐缺失子字段；null / 字符串等脏值退化为空结构', () => {
    expect(normalizeComponentValue(comp, { a: 'x' })).toEqual({ a: 'x', b: false });
    expect(normalizeComponentValue(comp, null)).toEqual({ a: undefined, b: false });
    expect(normalizeComponentValue(comp, 'garbage')).toEqual({ a: undefined, b: false });
    expect(normalizeComponentValue(comp, [1, 2])).toEqual({ a: undefined, b: false });
  });

  it('repeatable：非数组输入退化为 []，数组逐项补齐', () => {
    const rep: FieldDef = { ...comp, repeatable: true };
    expect(normalizeComponentValue(rep, [{ a: '1' }, { b: true }])).toEqual([
      { a: '1', b: false },
      { a: undefined, b: true },
    ]);
    expect(normalizeComponentValue(rep, null)).toEqual([]);
    expect(normalizeComponentValue(rep, 'x')).toEqual([]);
    expect(normalizeComponentValue(rep, { a: 'oops' })).toEqual([]); // 对象不是数组
  });

  it('不覆盖已有值（含显式 false —— 不能把"关"当成"没填"）', () => {
    expect(fillComponentItem(comp, { a: 'y', b: true })).toEqual({ a: 'y', b: true });
    expect(fillComponentItem(comp, { b: false })).toEqual({ a: undefined, b: false });
  });
});

describe('emptyComponentValue / emptyFormValues', () => {
  it('空 component 保留全部子字段键（顺序稳定，便于后续赋值）', () => {
    const comp = F('component', {
      fields: [
        { name: 'x', type: 'text' },
        { name: 'y', type: 'boolean' },
      ],
    });
    expect(Object.keys(emptyComponentValue(comp))).toEqual(['x', 'y']);
  });

  it('整条记录按字段定义初始化', () => {
    const fields: FieldDef[] = [
      { name: 'title', type: 'text' },
      { name: 'ok', type: 'boolean' },
      { name: 'blocks', type: 'component', repeatable: true, fields: [{ name: 'x', type: 'text' }] },
    ];
    expect(emptyFormValues(fields)).toEqual({ title: undefined, ok: false, blocks: [] });
  });

  it('嵌套 component 的空值也是结构（不是 undefined）', () => {
    const fields: FieldDef[] = [
      {
        name: 'outer',
        type: 'component',
        fields: [
          { name: 'inner', type: 'component', fields: [{ name: 'deep', type: 'text' }] },
        ],
      },
    ];
    expect(emptyFormValues(fields)).toEqual({ outer: { inner: { deep: undefined } } });
  });
});
