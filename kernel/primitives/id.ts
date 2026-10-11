// kernel/primitives/id.ts
// 统一 ID 生成入口 —— 禁止在业务代码里散落 randomUUID()。
// 形态：租户用短 id（8 字符 base62）；其他实体用 UUIDv7（时间有序，索引友好）。
// 依据：docs/design.md 7.2、engineering-spec 4.1.1、6.5。

import { randomBytes } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const TENANT_ID_LENGTH = 8;

/** 将字节流转为 base62 字符串 */
function toBase62(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += BASE62[byte % 62];
  }
  return out;
}

/** 同毫秒内的单调计数器（rand_a 12 位）：保证 UUIDv7 严格递增（规范推荐）。
 *  用途：同毫秒批量写入时按 id 排序稳定（审计日志、列表 tie-break 等）。 */
let lastMs = 0;
let seqInMs = 0;

/**
 * 通用实体 id：UUIDv7（时间有序，**同毫秒内单调递增**）。
 * 自实现：48 位毫秒时间戳 + 12 位同毫秒序号 + 版本/变体位 + 随机位。
 * 不依赖第三方 uuid 库，保持内核零外部依赖。
 */
export function newId(): string {
  const ms = Date.now();
  if (ms === lastMs) {
    seqInMs = (seqInMs + 1) & 0xfff; // 12 位内循环；同毫秒 4096 个 id 后回绕（可接受）
  } else {
    lastMs = ms;
    seqInMs = 0;
  }
  const now = BigInt(ms);
  const bytes = new Uint8Array(16);

  // 前 48 位：毫秒时间戳（大端）
  bytes[0] = Number((now >> 40n) & 0xffn);
  bytes[1] = Number((now >> 32n) & 0xffn);
  bytes[2] = Number((now >> 24n) & 0xffn);
  bytes[3] = Number((now >> 16n) & 0xffn);
  bytes[4] = Number((now >> 8n) & 0xffn);
  bytes[5] = Number(now & 0xffn);

  // 第 6-7 字节低 12 位：同毫秒序号（rand_a，单调递增）
  bytes[6] = (seqInMs >> 8) & 0x0f;
  bytes[7] = seqInMs & 0xff;

  // 其余 62 位随机（rand_b）
  const rand = randomBytes(8);
  for (let i = 0; i < 8; i++) bytes[8 + i] = rand[i] ?? 0;

  // 版本位（第 7 字节高 4 位 = 0111 => v7）；序号只占 bytes[6] 低 4 位 + bytes[7] 全部
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // 变体位（第 9 字节高 2 位 = 10）
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 租户 id：短 id（8 字符 base62）。
 * 短、可读、可手抄；写入后不可修改；落库前调用方需查重。
 */
export function newTenantId(): string {
  return toBase62(randomBytes(TENANT_ID_LENGTH)).slice(0, TENANT_ID_LENGTH);
}

/** 校验租户短 id 形态 */
export function isValidTenantId(id: string): boolean {
  if (id.length !== TENANT_ID_LENGTH) return false;
  for (const ch of id) if (!BASE62.includes(ch)) return false;
  return true;
}

// ---- 软删除语义封装（哨兵值法：活跃=0，删除=真实毫秒；见 7.4）----

/** 未删除哨兵值 */
export const NOT_DELETED = 0;

/** 查询条件：仅未删除 */
export const notDeleted = (): { deletedAt: number } => ({ deletedAt: NOT_DELETED });

/** 标记删除：返回删除时刻 */
export const markDeleted = (): { deletedAt: number } => ({ deletedAt: Date.now() });

/** 判断是否处于未删除状态 */
export const isActive = (deletedAt: number): boolean => deletedAt === NOT_DELETED;
