// kernel/contracts/revision.contract.ts
// 内容版本历史（通用能力）：为每次内容写入留一份快照，支持查看与回滚。
//
// 与 audit 同属"旁路能力"——只消费内容事件与显式调用，语义里没有任何业务词。
// 存的是**整份 data 快照**而非 diff：实现简单、回滚无歧义，代价是空间，
// 对单机 CMS 的内容量级完全可接受。

import type { Entity } from '../primitives/entity.js';
import type { Principal } from '../primitives/principal.js';

export interface Revision {
  id: string;
  /** 关联的条目 id */
  entryId: string;
  /** 条目类型 slug（便于按类型检索） */
  type: string;
  /** 同一 entry 内递增，从 1 开始 */
  version: number;
  slug: string | null;
  status: string;
  /** 该版本的完整 data 快照 */
  snapshot: Record<string, unknown>;
  /** 触发本次版本的操作者 id（无法确定时为空串） */
  actorId: string;
  createdAt: number;
}

export interface RevisionService {
  /** 某条目的历史（新 → 旧） */
  list(entryId: string, tenantId: string, limit?: number): Promise<Revision[]>;
  /** 取指定版本；不存在返回 null */
  get(entryId: string, tenantId: string, version: number): Promise<Revision | null>;
  /**
   * 回滚到指定版本：把该版本的 data / slug / status 写回条目。
   * 写回**本身也会产生一个新版本**——历史只增不减，回滚后还能再滚回来。
   */
  rollback(entryId: string, tenantId: string, version: number, actor: Principal): Promise<Entity>;
}
