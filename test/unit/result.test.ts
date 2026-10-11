import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, platformError } from '@kernel/primitives/result.js';

describe('result type', () => {
  it('ok / err 构造', () => {
    const a = ok(42);
    expect(a.ok).toBe(true);
    if (isOk(a)) expect(a.value).toBe(42);

    const b = err(platformError('E_NOT_FOUND', '没找到'));
    expect(b.ok).toBe(false);
    if (isErr(b)) expect(b.error.code).toBe('E_NOT_FOUND');
  });

  it('不抛异常：错误作为值传递', () => {
    const fn = () => err(platformError('E_X', 'x'));
    expect(() => fn()).not.toThrow();
  });
});
