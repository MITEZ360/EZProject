// kernel/primitives/result.ts
// 统一返回类型：跨模块调用不抛异常，错误作为值显式传递。

export interface PlatformError {
  code: string;
  message: string;
  /** 附加信息（不参与业务逻辑，仅用于诊断） */
  details?: Record<string, unknown>;
}

export type Result<T, E = PlatformError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E = PlatformError>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

/** 便捷构造一个平台错误 */
export const platformError = (
  code: string,
  message: string,
  details?: Record<string, unknown>
): PlatformError => (details ? { code, message, details } : { code, message });

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;
