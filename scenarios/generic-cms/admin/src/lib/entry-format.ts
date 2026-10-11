// scenarios/generic-cms/admin/src/lib/entry-format.ts
// 条目与字段值的**纯函数**工具（无 React 依赖，故可直接单测）。
//
// 通用 CMS 的铁律：本文件不出现任何业务字段名。
// 标题从 data 里按"常见命名"探测，空值按字段类型递归构造——两者只看 FieldDef。

import type { FieldDef } from '@kernel/primitives/entity.js';

/** 候选标题字段（按优先级）。通用 CMS 不写死业务字段，只做常见命名探测 */
const TITLE_KEYS = ['title', 'name', 'label', 'subject', 'heading'];

export interface EntryLike {
  id: string;
  slug?: string | null;
  data?: Record<string, unknown>;
}

/**
 * 条目的人类可读标题。
 * 优先级：常见标题字段 → slug → id 前缀。
 * 用途：relation 选择器的选项文案、引用值的回显。
 */
export function entryTitle(entry: EntryLike): string {
  for (const key of TITLE_KEYS) {
    const v = entry.data?.[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  if (entry.slug) return entry.slug;
  return entry.id.slice(0, 8);
}

/**
 * 字段的"空值"——新建条目、component 数组新增一项时用。
 * 按类型递归：boolean 给 false（开关需要确定态），多选给 []，
 * 可重复 component 给 []，单实例 component 递归构造子字段。
 */
export function emptyFieldValue(field: FieldDef): unknown {
  switch (field.type) {
    case 'boolean':
      return false;
    case 'select':
      return field.multiple ? [] : undefined;
    case 'component':
      return field.repeatable ? [] : emptyComponentValue(field);
    default:
      return undefined;
  }
}

/** component 单实例的空值（子字段递归） */
export function emptyComponentValue(field: FieldDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of field.fields ?? []) out[f.name] = emptyFieldValue(f);
  return out;
}

/** 整条记录的空表单值 */
export function emptyFormValues(fields: FieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f.name] = emptyFieldValue(f);
  return out;
}

/**
 * component 值规整为表单可直接编辑的形态。
 * 存量数据可能是 null / 缺字段 / 类型不符（早期用 JSON 文本框存的），
 * 这里统一补成结构，避免渲染期到处判空。
 */
export function normalizeComponentValue(field: FieldDef, value: unknown): unknown {
  if (field.repeatable) {
    const arr = Array.isArray(value) ? value : [];
    return arr.map((item) => fillComponentItem(field, item));
  }
  return fillComponentItem(field, value);
}

/** 用子字段定义补齐单个 component 实例（缺的字段给空值） */
export function fillComponentItem(field: FieldDef, item: unknown): Record<string, unknown> {
  const src = (item && typeof item === 'object' && !Array.isArray(item) ? item : {}) as Record<
    string,
    unknown
  >;
  const out: Record<string, unknown> = {};
  for (const f of field.fields ?? []) {
    out[f.name] = src[f.name] === undefined ? emptyFieldValue(f) : src[f.name];
  }
  return out;
}
