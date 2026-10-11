// kernel/primitives/principal.ts
// 主体原语：谁在操作。内核只认"主体 + 能力"，不认具体角色名。

export interface Principal {
  /** 主体 id（用户/系统账号/服务） */
  id: string;
  tenantId: string;
  /** 主体类型：内核不限定取值 */
  kind: string;
  /** 能力标签（权限判断由 authz 模块解释，内核只传） */
  capabilities?: string[];
  /** 附加属性（预留） */
  attributes?: Record<string, unknown>;
}

/** 系统主体：平台自身发起的操作（迁移、定时任务等） */
export const systemPrincipal = (tenantId: string): Principal => ({
  id: 'system',
  tenantId,
  kind: 'system',
});
