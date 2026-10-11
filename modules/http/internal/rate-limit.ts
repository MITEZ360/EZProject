// modules/http/internal/rate-limit.ts
// 限流策略（纯模块层——限流是 HTTP 关切，内核无需新增契约）。
//
// 单机定位：不引入独立服务（Redis 限流），内存固定窗口计数足够。
// **必须有界**：桶的数量由客户端 IP 决定，无界 Map 会重蹈缓存那个坑
// （外部可撑爆内存）——故设 maxKeys 上限 + 过期清扫 + 最旧淘汰。

export interface RateLimitVerdict {
  allowed: boolean;
  /** 被拒时建议的重试等待秒数（用于 Retry-After） */
  retryAfterSeconds: number;
}

export interface RateLimitPolicy {
  readonly name: string;
  /**
   * 记一次访问并判定是否放行。
   * @param key 维度键（如 `api:1.2.3.4`）
   * @param max 本类别的每窗口额度（不同入口可给不同额度）
   */
  check(key: string, max: number): RateLimitVerdict;
}

export interface MemoryRateLimitOptions {
  /** 窗口长度（秒），默认 60 */
  windowSeconds?: number;
  /**
   * 桶数量上限（防 key 泛滥打爆限流器自身），默认 10000。
   * 超限时先清过期桶，仍超则淘汰最旧（Map 保序）。
   */
  maxKeys?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function createMemoryRateLimit(options: MemoryRateLimitOptions = {}): RateLimitPolicy {
  const windowMs = (options.windowSeconds ?? 60) * 1000;
  const maxKeys = options.maxKeys ?? 10_000;
  const buckets = new Map<string, Bucket>();

  const purgeExpired = (now: number): void => {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  };

  return {
    name: 'memory',

    check(key: string, max: number): RateLimitVerdict {
      const now = Date.now();

      // 有界保障：满了先清过期，仍满则淘汰最旧（最旧的通常已过期或最不活跃）
      if (buckets.size >= maxKeys) {
        purgeExpired(now);
        while (buckets.size >= maxKeys) {
          const oldest = buckets.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          buckets.delete(oldest);
        }
      }

      const b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      b.count += 1;
      if (b.count > max) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/**
 * 取客户端标识（用于限流维度）。
 * 反向代理场景优先用 X-Forwarded-For 首段；直连时退化为 'local'
 * （此时限流退化为"全局额度"，仍能挡住爬虫洪峰，只是无法按来源区分）。
 */
export function clientIp(headers: {
  get(name: string): string | null;
}): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') ?? 'local';
}
