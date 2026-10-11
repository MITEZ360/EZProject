// modules/content/internal/validate.ts
// 写入校验：所有写入入口强制。字段类型集见决策 #26（engineering-spec 4.2.1）。
// 铁律：richText 字段必须是 Portable Text 结构，禁止 HTML 字符串。
// 内部实现——禁止外部 import。

import type { EntityTypeDef, FieldDef } from '@kernel/primitives/entity.js';
import { isPortableText } from '@kernel/primitives/portable-text.js';
import { portableTextSchema } from '@kernel/primitives/portable-text.schema.js';

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/** 保留键：映射到顶层物理列（status/slug），允许出现在 data 中但不属于字段定义 */
const RESERVED_KEYS = new Set(['status', 'slug']);

/** component 递归深度上限（决策 #26） */
const MAX_COMPONENT_DEPTH = 3;

/** 校验实体数据是否符合其类型定义。 */
export function validateEntityData(
  typeDef: EntityTypeDef,
  data: Record<string, unknown>
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // 未知字段拒绝（保留键 status/slug 除外）——拼错字段名必须在写入时暴露
  for (const key of Object.keys(data)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (!typeDef.fields.some((f) => f.name === key)) {
      issues.push({ field: key, message: `未在类型 "${typeDef.slug}" 中定义的字段` });
    }
  }

  for (const field of typeDef.fields) {
    const value = data[field.name];
    if (value === undefined || value === null) {
      if (field.required) {
        issues.push({ field: field.name, message: '必填字段缺失' });
      }
      continue;
    }
    validateField(field, value, field.name, issues, 1);
  }

  return { ok: issues.length === 0, issues };
}

function validateField(
  field: FieldDef,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  depth: number
): void {
  const fail = (message: string): void => {
    issues.push({ field: path, message });
  };

  switch (field.type) {
    case 'text': {
      if (typeof value !== 'string') return fail('应为字符串');
      if (field.pattern && !new RegExp(field.pattern).test(value)) {
        return fail(`不匹配格式 ${field.pattern}`);
      }
      checkRange(path, value.length, field, fail);
      return;
    }

    case 'longText': {
      if (typeof value !== 'string') return fail('应为字符串');
      checkRange(path, value.length, field, fail);
      return;
    }

    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) return fail('应为数字');
      if (field.integer && !Number.isInteger(value)) return fail('应为整数');
      checkRange(path, value, field, fail);
      return;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') return fail('应为布尔');
      return;
    }

    case 'date': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail('应为 epoch 毫秒数字');
      }
      if (field.dateOnly) {
        const d = new Date(value);
        const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        if (value !== midnight) return fail('dateOnly 字段必须为 UTC 零点毫秒');
      }
      checkRange(path, value, field, fail);
      return;
    }

    case 'select': {
      if (!field.options || field.options.length === 0) {
        return fail('select 字段必须声明 options');
      }
      if (field.multiple) {
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
          return fail('多选取值应为字符串数组');
        }
        const bad = value.filter((v) => !field.options!.includes(v as string));
        if (bad.length > 0) return fail(`取值不在选项内：${bad.join('、')}`);
      } else {
        if (typeof value !== 'string') return fail('单选取值应为字符串');
        if (!field.options.includes(value)) return fail(`取值不在选项内：${value}`);
      }
      return;
    }

    case 'richText': {
      if (typeof value === 'string') {
        return fail('富文本禁止存 HTML/字符串，必须存 Portable Text 结构（见内容铁律）');
      }
      if (!isPortableText(value)) return fail('富文本必须是 Portable Text 块数组');
      const parsed = portableTextSchema.safeParse(value);
      if (!parsed.success) {
        fail(`Portable Text 结构非法：${parsed.error.issues[0]?.message ?? '未知'}`);
      }
      return;
    }

    case 'component': {
      if (!field.fields || field.fields.length === 0) {
        return fail('component 字段必须声明 fields');
      }
      if (depth > MAX_COMPONENT_DEPTH) {
        return fail(`component 嵌套超过 ${MAX_COMPONENT_DEPTH} 层`);
      }
      const items = field.repeatable ? value : [value];
      if (!Array.isArray(items)) return fail('component 值结构非法');
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          fail('component 值应为对象');
          continue;
        }
        validateComponentItem(field, item as Record<string, unknown>, path, i, issues, depth);
      }
      return;
    }

    case 'relation':
    case 'media': {
      if (typeof value !== 'string' || value.length === 0) {
        return fail(`${field.type} 引用应为非空 ID 字符串`);
      }
      return;
    }

    case 'json': {
      // 逃生舱：不解释结构（缺失已由必填检查处理）
      return;
    }
  }
}

/** component 内部按子字段定义校验；多余键同样拒绝 */
function validateComponentItem(
  field: FieldDef,
  item: Record<string, unknown>,
  path: string,
  index: number,
  issues: ValidationIssue[],
  depth: number
): void {
  const subFields = field.fields!;
  for (const key of Object.keys(item)) {
    if (!subFields.some((f) => f.name === key)) {
      issues.push({ field: `${path}[${index}].${key}`, message: '未在 component 中定义的字段' });
    }
  }
  for (const sub of subFields) {
    const v = item[sub.name];
    if (v === undefined || v === null) {
      if (sub.required) {
        issues.push({ field: `${path}[${index}].${sub.name}`, message: '必填字段缺失' });
      }
      continue;
    }
    validateField(sub, v, `${path}[${index}].${sub.name}`, issues, depth + 1);
  }
}

function checkRange(
  path: string,
  n: number,
  field: FieldDef,
  fail: (m: string) => void
): void {
  if (field.min !== undefined && n < field.min) fail(`不能小于 ${field.min}`);
  if (field.max !== undefined && n > field.max) fail(`不能大于 ${field.max}`);
}
