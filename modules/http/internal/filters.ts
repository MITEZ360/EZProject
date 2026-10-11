// modules/http/internal/filters.ts
// 查询参数 → QueryFilter（决策 #26：自定义字段等值/范围/包含查询的 API 形态）。
// 约定：filter[字段路径][操作]=值
//   ?filter[price][gte]=100          → { field: 'price', op: 'gte', value: 100 }
//   ?filter[data.title][contains]=hi
//   ?filter[tags][contains]=hot,cold → contains 数组（数组包含语义）
//   ?filter[status][in]=draft,published
// 值类型推断：数字 / true|false / 逗号数组（in/contains）/ 其余字符串。

import type { QueryFilter } from '@kernel/contracts/storage.contract.js';

const OPS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']);
const FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
const PARAM_RE = /^filter\[([^\]]+)\]\[([^\]]+)\]$/;

function coerce(raw: string, op: QueryFilter['op']): unknown {
  if (op === 'in') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (op === 'contains') {
    // 含逗号 → 数组包含；否则标量子串/元素包含
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts : raw;
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

export interface ParsedFilters {
  filters: QueryFilter[];
  /** 非法参数（字段路径/操作符不合法）——上层据此返回 400，避免静默忽略 */
  errors: string[];
}

/**
 * @param topLevel 顶层物理列白名单；提供时，单段字段名不在白名单内则自动视为
 *   内容字段（加 'data.' 前缀）——对外 API 不暴露存储形状（决策 #26）。
 */
export function parseFilters(
  query: Record<string, string | undefined>,
  topLevel?: ReadonlySet<string>
): ParsedFilters {
  const filters: QueryFilter[] = [];
  const errors: string[] = [];

  for (const [key, raw] of Object.entries(query)) {
    const m = PARAM_RE.exec(key);
    if (!m || raw === undefined) continue;
    let field = m[1] ?? '';
    const op = m[2] ?? '';
    if (!FIELD_RE.test(field)) {
      errors.push(`非法字段路径: ${field}`);
      continue;
    }
    if (topLevel && !field.includes('.') && !topLevel.has(field)) {
      field = `data.${field}`; // 内容字段：对外写 filter[price][gte]，对内落 data.price
    }
    if (!OPS.has(op)) {
      errors.push(`非法操作符: ${op}（可用: ${[...OPS].join('/')}）`);
      continue;
    }
    filters.push({ field, op: op as QueryFilter['op'], value: coerce(raw, op as QueryFilter['op']) });
  }
  return { filters, errors };
}
