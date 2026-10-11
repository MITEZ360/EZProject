// scenarios/blog/admin/src/lib/api.ts
// Management API 客户端：统一带 Bearer Token；错误显式化为 ApiError。

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const tokenKey = 'admin.token';
export const getToken = (): string => localStorage.getItem(tokenKey) ?? '';
export const setToken = (t: string): void => localStorage.setItem(tokenKey, t);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json['error'] ?? {}) as { code?: string; message?: string };
    throw new ApiError(res.status, err.code ?? 'E_UNKNOWN', err.message ?? res.statusText);
  }
  return json as T;
}

export interface EntryItem {
  id: string;
  type: string;
  slug?: string;
  status: string;
  locale: string;
  updatedAt: number;
  data: Record<string, unknown>;
}

/** 通用内容 API：类型只是路径参数——通用 CMS 不写死任何业务类型 */
export const api = {
  listEntries: (type: string) =>
    request<{ items: EntryItem[]; total: number }>(
      'GET',
      `/api/v1/${type}?status=all&limit=100`
    ),

  createEntry: (type: string, data: Record<string, unknown>) =>
    request<EntryItem>('POST', `/api/manage/v1/${type}`, data),

  updateEntry: (type: string, id: string, data: Record<string, unknown>) =>
    request<EntryItem>('PUT', `/api/manage/v1/${type}/${id}`, data),

  deleteEntry: (type: string, id: string) =>
    request<{ ok: boolean }>('DELETE', `/api/manage/v1/${type}/${id}`),

  health: () => request<{ ok: boolean }>('GET', '/healthz'),
};

// ==================== 类型管理（决策 #26：类型定义是数据） ====================
// 类型直接复用内核原语（单一事实来源），不复制定义

import type { EntityTypeDef, FieldDef } from '@kernel/primitives/entity.js';
export type { EntityTypeDef, FieldDef };

export const FIELD_TYPE_LABELS: Record<FieldDef['type'], string> = {
  text: '短文本',
  longText: '长文本',
  number: '数字',
  boolean: '布尔',
  date: '日期',
  select: '枚举',
  richText: '富文本',
  component: '嵌套结构',
  relation: '内容引用',
  media: '媒体引用',
  json: '任意 JSON',
};

export const apiTypes = {
  listTypes: () => request<{ items: EntityTypeDef[] }>('GET', '/api/manage/v1/types'),
  defineType: (def: EntityTypeDef) =>
    request<{ ok: boolean }>('POST', '/api/manage/v1/types', def),
};

// ==================== 通用管理能力（模块贡献端点） ====================

export interface AuditEntry {
  id: string;
  tenantId: string;
  event: string;
  actorId: string;
  detail: Record<string, unknown>;
  occurredAt: number;
}

export interface SettingItem {
  key: string;
  value: unknown;
  updatedAt: number;
}

export const auditApi = {
  list: (event?: string) =>
    request<{ items: AuditEntry[] }>(
      'GET',
      `/api/manage/v1/audit-logs?limit=100${event ? `&event=${encodeURIComponent(event)}` : ''}`
    ),
};

export const settingsApi = {
  list: () => request<{ items: SettingItem[] }>('GET', '/api/manage/v1/settings'),
  set: (key: string, value: unknown) =>
    request<{ ok: boolean }>('PUT', `/api/manage/v1/settings/${encodeURIComponent(key)}`, { value }),
};
