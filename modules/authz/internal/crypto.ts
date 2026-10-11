// modules/authz/internal/crypto.ts
// 密码与令牌原语（零依赖）：
// - 口令哈希：scrypt + 随机盐 + 恒定时间比较（OWASP 推荐之一）
// - 访问令牌：HMAC-SHA256 签名的 JWT（自实现，避免引入依赖）
// - 刷新令牌：高熵随机串，落库只存 SHA-256 哈希（泄库不可直接复用）

import { createHmac, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

// ---------- 口令 ----------

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[2] ?? '', 'hex');
  const expected = Buffer.from(parts[3] ?? '', 'hex');
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------- JWT（HMAC-SHA256） ----------

export interface JwtClaims {
  sub: string;
  tenantId: string;
  roles: string[];
  /** 签发时间（秒） */
  iat: number;
  /** 过期时间（秒） */
  exp: number;
  typ: 'access';
}

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString('base64url');

export function signJwt(claims: JwtClaims, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const data = `${header}.${payload}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/** 校验 JWT：签名 + 结构 + 过期。失败返回 null（不抛异常，调用方统一按"未认证"处理）。 */
export function verifyJwt(token: string, secret: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JwtClaims;
    if (claims.typ !== 'access' || typeof claims.exp !== 'number') return null;
    if (claims.exp * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

// ---------- 刷新令牌 ----------

/** 生成刷新令牌（明文只回给客户端一次）；落库的是其 SHA-256 */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
