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

const ACCESS_KEY = 'admin.access';
const REFRESH_KEY = 'admin.refresh';
export const getToken = (): string => localStorage.getItem(ACCESS_KEY) ?? '';
export const setToken = (t: string): void => {
  // 兼容：单令牌模式（引导令牌 / 开发）直接作为 access 令牌
  localStorage.setItem(ACCESS_KEY, t);
  localStorage.removeItem(REFRESH_KEY);
};
export const clearTokens = (): void => {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
};
export const hasSession = (): boolean =>
  Boolean(localStorage.getItem(ACCESS_KEY) || localStorage.getItem(REFRESH_KEY));

/** 刷新令牌（并发请求只触发一次刷新） */
let refreshing: Promise<boolean> | null = null;
async function refreshSession(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/manage/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const pair = (await res.json()) as { accessToken: string; refreshToken: string };
      localStorage.setItem(ACCESS_KEY, pair.accessToken);
      localStorage.setItem(REFRESH_KEY, pair.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry && (await refreshSession())) {
    return request<T>(method, path, body, false); // 刷新成功，重放一次
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json['error'] ?? {}) as { code?: string; message?: string };
    throw new ApiError(res.status, err.code ?? 'E_UNKNOWN', err.message ?? res.statusText);
  }
  return json as T;
}

export const authApi = {
  /** 邮箱密码登录：拿到 access + refresh */
  login: async (email: string, password: string) => {
    const pair = await request<{ accessToken: string; refreshToken: string; expiresIn: number }>(
      'POST',
      '/api/manage/v1/auth/login',
      { email, password }
    );
    localStorage.setItem(ACCESS_KEY, pair.accessToken);
    localStorage.setItem(REFRESH_KEY, pair.refreshToken);
    return pair;
  },
  logout: async () => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (refreshToken) {
      await request('POST', '/api/manage/v1/auth/logout', { refreshToken }).catch(() => undefined);
    }
    clearTokens();
  },
  me: () => request<{ principal: Record<string, unknown> }>('GET', '/api/manage/v1/auth/me'),
};

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
  listEntries: (type: string, limit = 100) =>
    request<{ items: EntryItem[]; total: number }>(
      'GET',
      `/api/v1/${type}?status=all&limit=${limit}`
    ),

  createEntry: (type: string, data: Record<string, unknown>) =>
    request<EntryItem>('POST', `/api/manage/v1/${type}`, data),

  updateEntry: (type: string, id: string, data: Record<string, unknown>) =>
    request<EntryItem>('PUT', `/api/manage/v1/${type}/${id}`, data),

  deleteEntry: (type: string, id: string) =>
    request<{ ok: boolean }>('DELETE', `/api/manage/v1/${type}/${id}`),

  health: () => request<{ ok: boolean }>('GET', '/healthz'),
};

// ==================== 全文检索 ====================
// 服务端为 /api/v1/search（中文单字切分 + 预览门）。管理端要搜到草稿，
// 故固定带 status=all —— 该参数属于预览读取，必须携带凭证（管理端已登录）。

export interface SearchHit {
  id: string;
  score: number;
  document: EntryItem;
}

export const searchApi = {
  search: (params: { q: string; type?: string; limit?: number }) => {
    const qs = new URLSearchParams({ q: params.q, status: 'all' });
    if (params.type) qs.set('type', params.type);
    qs.set('limit', String(params.limit ?? 50));
    return request<{ items: SearchHit[]; total: number }>('GET', `/api/v1/search?${qs}`);
  },
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

// ==================== 用户 / 角色（RBAC） ====================

export interface UserItem {
  id: string;
  email: string;
  name: string;
  roles: string[];
  status: string;
}
export interface AuthzPermission {
  resource: string;
  actions: string[];
  deniedFields?: string[];
}
export interface RoleItem {
  slug: string;
  name: string;
  permissions: AuthzPermission[];
  builtin?: boolean;
}

export const usersApi = {
  list: () => request<{ items: UserItem[] }>('GET', '/api/manage/v1/users'),
  create: (input: { email: string; name: string; password: string; roles: string[] }) =>
    request<UserItem>('POST', '/api/manage/v1/users', input),
  update: (id: string, patch: { name?: string; roles?: string[]; status?: string }) =>
    request<UserItem>('PUT', `/api/manage/v1/users/${id}`, patch),
  setPassword: (id: string, password: string) =>
    request<{ ok: boolean }>('POST', `/api/manage/v1/users/${id}/password`, { password }),
};

export const rolesApi = {
  list: () => request<{ items: RoleItem[] }>('GET', '/api/manage/v1/roles'),
  upsert: (role: { slug: string; name: string; permissions: AuthzPermission[] }) =>
    request<RoleItem>('POST', '/api/manage/v1/roles', role),
  remove: (slug: string) => request<{ ok: boolean }>('DELETE', `/api/manage/v1/roles/${slug}`),
};

// ==================== 媒体资产 ====================

export interface AssetItem {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  url?: string;
}

export const assetsApi = {
  list: () => request<{ items: AssetItem[] }>('GET', '/api/manage/v1/assets'),
  /** 上传（multipart/form-data；不经 request 封装，避免 JSON 序列化） */
  upload: async (file: File): Promise<AssetItem> => {
    const form = new FormData();
    form.set('file', file);
    const res = await fetch('/api/manage/v1/assets', {
      method: 'POST',
      headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {},
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (json['error'] ?? {}) as { code?: string; message?: string };
      throw new ApiError(res.status, err.code ?? 'E_UNKNOWN', err.message ?? res.statusText);
    }
    return json as unknown as AssetItem;
  },
  remove: (id: string) => request<{ ok: boolean }>('DELETE', `/api/manage/v1/assets/${id}`),
};
