// modules/http/internal/errors.ts
// 把模块层错误（error.name = 内核错误码）映射为 HTTP 状态码。
// 约定：服务层抛 Error 且 name 为 E_* 错误码；这里只做"错误码 → 状态码"的纯映射。

const STATUS_BY_CODE: Record<string, number> = {
  E_VALIDATION: 400,
  E_TYPE_UNKNOWN: 400,
  E_UNAUTHORIZED: 401,
  E_FORBIDDEN: 403,
  E_NO_ROLE: 403,
  E_NOT_FOUND: 404,
  E_CONFLICT: 409,
};

export type HttpStatus = 400 | 404 | 409 | 500;

export function statusOf(e: unknown): HttpStatus {
  const code = (e as Error | null)?.name ?? '';
  return (STATUS_BY_CODE[code] ?? 500) as HttpStatus;
}

/** 统一错误响应体（不泄漏内部细节） */
export function errorBody(e: unknown) {
  const err = e as Error;
  return {
    error: {
      code: STATUS_BY_CODE[err?.name ?? ''] ? err.name : 'E_INTERNAL',
      message: STATUS_BY_CODE[err?.name ?? ''] ? err.message : '内部错误',
    },
  };
}
