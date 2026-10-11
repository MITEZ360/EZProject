// modules/audit/index.ts
// 审计日志模块（通用能力）：订阅 content 领域事件，落模块私有表 audit_logs。
// 宪法三的正宗用例——audit 只听事件，不知道 content 的存在；content 不知道谁在听。
// 私有表经 StorageTx.exec 创建（契约 v2：仅限模块私有表维护）。

import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import type { StorageDriver, TableDef } from '@kernel/contracts/storage.contract.js';
import type { AuditEntry, AuditQuery, AuditService } from '@kernel/contracts/audit.contract.js';
import type { DomainEvent } from '@kernel/events/types.js';
import { newId } from '@kernel/primitives/id.js';
import { Tokens } from '@kernel/registry.js';

/** 私有表声明（**声明式建表**：物理类型由存储层按方言落地，模块不写 BIGINT/TEXT） */
const AUDIT_LOGS: TableDef = {
  table: 'audit_logs',
  columns: [
    { name: 'id', type: 'text', primaryKey: true },
    { name: 'tenant_id', type: 'text', notNull: true },
    { name: 'event', type: 'text', notNull: true },
    { name: 'actor_id', type: 'text', notNull: true },
    { name: 'detail', type: 'json', notNull: true },
    { name: 'occurred_at', type: 'timestamp', notNull: true },
  ],
  // 审计按租户倒序翻页（同毫秒内再由 id 次级排序，见 list）
  indexes: [{ name: 'ix_audit_tenant_time', columns: ['tenant_id', '-occurred_at'] }],
  schema: {
    columns: { tenantId: 'tenant_id', actorId: 'actor_id', occurredAt: 'occurred_at' },
    jsonColumns: ['detail'],
  },
};

const WATCHED_EVENTS = [
  'content.entry.created',
  'content.entry.updated',
  'content.entry.deleted',
];

export function auditModule(): PlatformModule {
  let driver: StorageDriver | undefined;
  const unsubscribes: Array<() => void> = [];

  const service: AuditService = {
    async list(query: AuditQuery): Promise<AuditEntry[]> {
      if (!driver) throw new Error('[audit] 模块未就绪');
      return driver.transaction(async (tx) => {
        const rows = await tx.find<{
          id: string; tenantId: string; event: string; actorId: string;
          detail: Record<string, unknown>; occurredAt: number;
        }>({
          table: 'audit_logs',
          where: { tenantId: query.tenantId },
          filters: query.event ? [{ field: 'event', op: 'eq', value: query.event }] : undefined,
          // 同毫秒内按 id（UUIDv7 时间有序）次级排序，保证审计顺序稳定
          orderBy: [
            { field: 'occurredAt', dir: 'desc' },
            { field: 'id', dir: 'desc' },
          ],
          limit: query.limit ?? 100,
        });
        return rows;
      });
    },
  };

  return {
    name: 'audit',
    dependsOn: ['storage'], // 只依赖 storage（经注册表）与事件名（模块公共契约）

    async setup({ registry, events }): Promise<void> {
      driver = registry.require<StorageDriver>(Tokens.Storage);
      await driver.createTable(AUDIT_LOGS);

      const record = async (event: DomainEvent): Promise<void> => {
        const payload = event.payload as { id?: string; type?: string; slug?: string; actorId?: string };
        await driver!.transaction(async (tx) =>
          tx.insert('audit_logs', {
            id: newId(),
            tenantId: event.tenantId,
            event: event.name,
            actorId: payload.actorId ?? 'unknown',
            detail: payload,
            occurredAt: event.occurredAt,
          })
        );
      };

      for (const name of WATCHED_EVENTS) {
        unsubscribes.push(events.subscribe(name, record));
      }

      registry.provide<AuditService>(Tokens.Audit, service);
    },

    async teardown(): Promise<void> {
      for (const unsub of unsubscribes) unsub();
      unsubscribes.length = 0;
      driver = undefined;
    },
  };
}
