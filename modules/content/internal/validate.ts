// modules/content/internal/validate.ts
// 写入校验：所有写入入口强制。富文本字段必须存 Portable Text 结构（铁律）。
// 内部实现——禁止外部 import。

import { portableTextSchema } from '@kernel/primitives/portable-text.schema.js';
import type { EntityTypeDef, FieldDef } from '@kernel/primitives/entity.js';
import { isPortableText } from '@kernel/primitives/portable-text.js';

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/** 判断一个字段是否为富文本类型 */
export function isRichText(field: FieldDef): boolean {
  return field.type === 'richText';
}

/**
 * 校验实体数据是否符合其类型定义。
 * 重点铁律：richText 字段必须是 PortableText 结构数组，**禁止 HTML 字符串**。
 */
export function validateEntityData(
  typeDef: EntityTypeDef,
  data: Record<string, unknown>
): ValidationResult {
  const issues: ValidationIssue[] = [];

  for (const field of typeDef.fields) {
    const value = data[field.name];

    if (value === undefined || value === null) {
      if (field.required) {
        issues.push({ field: field.name, message: '必填字段缺失' });
      }
      continue;
    }

    if (isRichText(field)) {
      if (typeof value === 'string') {
        issues.push({
          field: field.name,
          message: '富文本禁止存 HTML/字符串，必须存 Portable Text 结构（见内容铁律）',
        });
        continue;
      }
      if (!isPortableText(value)) {
        issues.push({ field: field.name, message: '富文本必须是 Portable Text 块数组' });
        continue;
      }
      const parsed = portableTextSchema.safeParse(value);
      if (!parsed.success) {
        issues.push({
          field: field.name,
          message: `Portable Text 结构非法：${parsed.error.issues[0]?.message ?? '未知'}`,
        });
      }
    }

    if (field.type === 'number' && typeof value !== 'number') {
      issues.push({ field: field.name, message: '应为数字' });
    }
    if (field.type === 'boolean' && typeof value !== 'boolean') {
      issues.push({ field: field.name, message: '应为布尔' });
    }
    if (field.type === 'select' && field.options && !field.options.includes(String(value))) {
      issues.push({ field: field.name, message: `取值不在选项内：${String(value)}` });
    }
    if (field.type === 'text' && typeof value !== 'string') {
      issues.push({ field: field.name, message: '应为字符串' });
    }
  }

  return { ok: issues.length === 0, issues };
}
