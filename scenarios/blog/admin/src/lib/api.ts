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
