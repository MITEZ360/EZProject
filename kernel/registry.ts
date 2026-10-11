// kernel/registry.ts
// 模块注册表（扩展点插槽）。
// 职责：记录已挂载模块的能力，供其他模块通过"契约名"取用（而非 import 实现）。

export interface Registry {
  /** 注册一个具名能力（通常是某个契约的实现） */
  provide<T>(token: string, value: T): void;
  /** 按 token 取用能力；不存在则返回 undefined */
  get<T>(token: string): T | undefined;
  /** 按 token 取用能力；不存在则抛错（用于"必需依赖"） */
  require<T>(token: string): T;
  has(token: string): boolean;
  /** 已注册的 token 列表（自检/日志用） */
  tokens(): string[];
}

export function createRegistry(): Registry {
  const store = new Map<string, unknown>();

  return {
    provide<T>(token: string, value: T): void {
      store.set(token, value);
    },
    get<T>(token: string): T | undefined {
      return store.get(token) as T | undefined;
    },
    require<T>(token: string): T {
      if (!store.has(token)) {
        throw new Error(`[kernel] 能力未注册: ${token}`);
      }
      return store.get(token) as T;
    },
    has(token: string): boolean {
      return store.has(token);
    },
    tokens(): string[] {
      return [...store.keys()];
    },
  };
}

/** 能力 token 常量（中性命名，不含业务词） */
export const Tokens = {
  Storage: 'storage',
  Content: 'content',
  Authz: 'authz',
  Search: 'search',
  Audit: 'audit',
  Settings: 'settings',
} as const;

export type Token = (typeof Tokens)[keyof typeof Tokens];
