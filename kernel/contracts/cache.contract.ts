// kernel/contracts/cache.contract.ts
// 缓存契约（策略接口）：内核只定义"能缓存"，实现可为内存/Redis/无。
// 语义：JSON 可序列化的值；TTL 秒；失效按 key 前缀。

export interface CacheProvider {
  readonly name: string;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  /** 按前缀失效（内容变更时调用，如 invalidate('content:tenant01:')） */
  invalidate(prefix: string): Promise<void>;
}
