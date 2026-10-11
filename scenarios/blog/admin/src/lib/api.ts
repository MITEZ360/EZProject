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

export interface PostListItem {
  id: string;
  slug?: string;
  status: string;
  locale: string;
  updatedAt: number;
  data: { title?: string; body?: unknown };
}

export const api = {
  listPosts: (type = 'posts') =>
    request<{ items: PostListItem[]; total: number }>(
      'GET',
      `/api/v1/${type}?status=all&limit=100`
    ),

  createPost: (data: Record<string, unknown>) =>
    request<PostListItem>('POST', '/api/manage/v1/posts', data),

  updatePost: (id: string, data: Record<string, unknown>) =>
    request<PostListItem>('PUT', `/api/manage/v1/posts/${id}`, data),

  deletePost: (id: string) =>
    request<{ ok: boolean }>('DELETE', `/api/manage/v1/posts/${id}`),

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
