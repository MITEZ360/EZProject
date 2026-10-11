// modules/revision/index.ts
// 内容版本历史模块（通用能力）：订阅内容事件，为每次写入留一份完整快照。
//
// 宪法三：只听事件名、不 import content 实现；回查与写回都经内核 ContentService 契约。
// 事件总线的 publish 会 await 订阅者 → 版本落库与内容写入是**强一致**的。
//
// 为什么存整份快照而不是 diff：回滚无歧义、实现简单；单机 CMS 的内容量级下
// 空间代价可接受，且可用 maxPerEntry 限制每个条目的保留数。

import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import type { StorageDriver, TableDef } from '@kernel/contracts/storage.contract.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { Revision, RevisionService } from '@kernel/contracts/revision.contract.js';
import type { DomainEvent } from '@kernel/events/types.js';
import { newId } from '@kernel/primitives/id.js';
import { Tokens } from '@kernel/registry.js';

const REVISIONS: TableDef = {
  table: 'content_revisions',
  columns: [
    { name: 'id', type: 'text', primaryKey: true },
    { name: 'tenant_id', type: 'text', notNull: true },
    { name: 'entry_id', type: 'text', notNull: true },
    { name: 'type', type: 'text', notNull: true },
    { name: 'version', type: 'int', notNull: true },
    { name: 'slug', type: 'text' },
    { name: 'status', type: 'text', notNull: true },
    { name: 'snapshot', type: 'json', notNull: true },
    { name: 'actor_id', type: 'text', notNull: true },
    { name: 'created_at', type: 'timestamp', notNull: true },
  ],
  // 取历史总是"按条目 + 版本倒序"，索引照此建
  indexes: [{ name: 'ix_rev_entry', columns: ['tenant_id', 'entry_id', '-version'] }],
  schema: {
    columns: {
      tenantId: 'tenant_id',
      entryId: 'entry_id',
      actorId: 'actor_id',
      createdAt: 'created_at',
    },
    jsonColumns: ['snapshot'],
  },
};

export interface RevisionModuleOptions {
  /** 每个条目最多保留的版本数（0 = 不限）。默认 50，防单机库无限增长 */
  maxPerEntry?: number;
}

export function revisionModule(options: RevisionModuleOptions = {}): PlatformModule {
  const maxPerEntry = options.maxPerEntry ?? 50;
  let driver: StorageDriver | undefined;
  let content: ContentService | undefined;

  /** 取依赖（未就绪时给出明确错误，而不是 undefined 报错） */
  const deps = (): { driver: StorageDriver; content: ContentService } => {
    if (!driver || !content) throw new Error('[revision] 模块未就绪');
    return { driver, content };
  };

  const service: RevisionService = {
    async list(entryId, tenantId, limit = 50): Promise<Revision[]> {
      const { driver: d } = deps();
      return d.transaction((tx) =>
        tx.find<Revision>({
          table: 'content_revisions',
          where: { tenantId, entryId },
          orderBy: [{ field: 'version', dir: 'desc' }],
          limit,
        })
      );
    },

    async get(entryId, tenantId, version): Promise<Revision | null> {
      const { driver: d } = deps();
      return d.transaction((tx) =>
        tx.findOne<Revision>({
          table: 'content_revisions',
          where: { tenantId, entryId, version },
        })
      );
    },

    async rollback(entryId, tenantId, version, actor) {
      const { content: c } = deps();
      const rev = await service.get(entryId, tenantId, version);
      if (!rev) throw new Error(`[revision] 版本不存在：${version}`);
      // slug / status 是顶层列，同样要恢复——否则"回滚"只回滚了一半。
      // 写回本身会触发 content.entry.updated，从而**再产生一个新版本**（历史只增不减）。
      return c.update(entryId, {
        tenantId,
        data: { ...rev.snapshot, slug: rev.slug, status: rev.status },
        actor,
      });
    },
  };

  return {
    name: 'revision',
    dependsOn: ['storage', 'content'],

    async setup({ registry, events }): Promise<void> {
      driver = registry.require<StorageDriver>(Tokens.Storage);
      content = registry.require<ContentService>(Tokens.Content);
      await driver.createTable(REVISIONS);

      /** 为条目留一份快照（版本号 = 当前最大 + 1），并裁剪超限的旧版本 */
      const snapshotOf = async (entityId: string, tenantId: string): Promise<void> => {
        const entity = await content!.findOne(entityId, tenantId);
        if (!entity) return;
        await driver!.transaction(async (tx) => {
          const last = await tx.findOne<Revision>({
            table: 'content_revisions',
            where: { tenantId, entryId: entityId },
            orderBy: [{ field: 'version', dir: 'desc' }],
          });
          await tx.insert('content_revisions', {
            id: newId(),
            tenantId,
            entryId: entityId,
            type: entity.type,
            version: (last?.version ?? 0) + 1,
            slug: entity.slug ?? null,
            status: entity.status,
            snapshot: entity.data,
            // 事件 payload 里没有 actor（内容事件不带），留空串而非编造
            actorId: '',
            createdAt: Date.now(),
          });

          if (maxPerEntry > 0) {
            const all = await tx.find<Revision>({
              table: 'content_revisions',
              where: { tenantId, entryId: entityId },
              orderBy: [{ field: 'version', dir: 'desc' }],
            });
            for (const old of all.slice(maxPerEntry)) {
              await tx.delete('content_revisions', old.id);
            }
          }
        });
      };

      const onWrite = async (e: DomainEvent): Promise<void> => {
        const p = (e.payload ?? {}) as { id?: string };
        if (!p.id) return;
        await snapshotOf(p.id, e.tenantId);
      };

      // 创建与更新都留痕（删除不留：软删除后条目仍在，语义上"消失"由 status/事件表达）
      events.subscribe('content.entry.created', onWrite);
      events.subscribe('content.entry.updated', onWrite);

      registry.provide<RevisionService>(Tokens.Revision, service);
    },

    async teardown(): Promise<void> {
      driver = undefined;
      content = undefined;
    },
  };
}
