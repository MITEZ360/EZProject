// kernel/contracts/audit.contract.ts
// 审计能力契约：audit 模块实现；消费方（HTTP/后台）经注册表按契约取用。
// 数据来源：audit 模块订阅领域事件（宪法三），content 不知道谁在听。

export interface AuditEntry {
  id: string;
  tenantId: string;
  /** 领域事件名，如 'content.entry.updated' */
  event: string;
  actorId: string;
  /** 摘要（JSON）：目标资源等 */
  detail: Record<string, unknown>;
  /** epoch 毫秒整数 */
  occurredAt: number;
}

export interface AuditQuery {
  tenantId: string;
  /** 按事件名过滤（可选） */
  event?: string;
  limit?: number;
}

export interface AuditService {
  list(query: AuditQuery): Promise<AuditEntry[]>;
}
