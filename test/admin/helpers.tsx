// test/admin/helpers.tsx —— 管理端测试的公共夹具
//
// 统一在这里打桩 fetch，而不是每个用例各写一份：
// 组件只认 api 层，桩打在 fetch 上等于打在真实边界上（URL、方法、请求体
// 都能断言），比 mock 整个 api 模块更接近"真的在跑"。

import { vi } from 'vitest';

/** 记录所有收到的请求，供断言"点了保存真的发了 PATCH 吗" */
export interface Captured {
  method: string;
  path: string;
  body: unknown;
}

export interface RouteSpec {
  status?: number;
  json?: unknown;
}

export interface StubOptions {
  /** 路径 → 响应。路径用 includes 匹配，先注册先生效 */
  routes?: Record<string, RouteSpec>;
  /** 兜底响应 */
  fallback?: RouteSpec;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** 打桩 fetch，返回请求记录数组 */
export function stubFetch(opts: StubOptions = {}): Captured[] {
  const captured: Captured[] = [];
  const entries = Object.entries(opts.routes ?? {});

  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    captured.push({
      method,
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    const hit = entries.find(([key]) => path.includes(key));
    const spec = hit?.[1] ?? opts.fallback;
    if (!spec) return json({ error: { code: 'E_UNSTUBBED', message: `未打桩：${path}` } }, 500);
    return json(spec.json ?? {}, spec.status ?? 200);
  };

  vi.stubGlobal('fetch', vi.fn(impl));
  return captured;
}

/** 常用响应工厂 */
export const ok = <T,>(data: T): RouteSpec => ({ status: 200, json: data });

/** 类型定义样例（字段结构与内核契约一致） */
export const typeDefSample = (slug: string, name = slug) => ({
  slug,
  name,
  fields: [
    { key: 'title', label: '标题', type: 'text' as const, required: true },
    { key: 'body', label: '正文', type: 'richtext' as const },
    { key: 'cover', label: '封面', type: 'media' as const },
  ],
});

export const entrySample = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  slug: 'hello',
  status: 'published',
  type: 'post',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  data: { title: '第一篇', body: [], cover: '' },
  ...over,
});
