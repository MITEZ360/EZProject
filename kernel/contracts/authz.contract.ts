// kernel/contracts/authz.contract.ts
// 权限能力契约：内核只定义"能鉴权"，具体 RBAC/Scope/字段级由 authz 模块实现。

import type { Principal } from '../primitives/principal.js';

export interface AuthzAction {
  /** 资源类型，如 'entries'（中性，不写业务词） */
  resource: string;
  action: 'read' | 'create' | 'update' | 'delete';
  /** 目标资源 id（可选） */
  resourceId?: string;
}

export interface AuthzDecision {
  allowed: boolean;
  /** 被拒绝时的原因码 */
  reason?: string;
  /** 字段级拒绝列表 */
  deniedFields?: string[];
}

export interface AuthzService {
  can(principal: Principal, action: AuthzAction): Promise<AuthzDecision>;
}
