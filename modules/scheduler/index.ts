// modules/scheduler/index.ts
// 定时发布模块（通用能力）：到点把条目置为已发布。
//
// 实现用单机轮询（setInterval）：契约只声明"设定 / 取消 / 查询计划"，
// 何时执行属实现细节——不为这点诉求引入调度器依赖。
//
// 触发语义：到点后以 systemPrincipal 调 ContentService.update 置 status='published'，
// 随后清理计划。条目已被删除、或已是 published，都算成功（幂等）。

import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import type { StorageDriver, TableDef } from '@kernel/contracts/storage.contract.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type {
  ScheduleItem,
  ScheduleService,
} from '@kernel/contracts/schedule.contract.js';
import { newId } from '@kernel/primitives/id.js';
import { systemPrincipal } from '@kernel/primitives/principal.js';
import { Tokens } from '@kernel/registry.js';

const TABLE = 'scheduled_publishes';

const SCHEDULES: TableDef = {
  table: TABLE,
  columns: [
    { name: 'id', type: 'text', primaryKey: true },
    { name: 'entry_id', type: 'text', notNull: true },
    { name: 'tenant_id', type: 'text', notNull: true },
    { name: 'type', type: 'text', notNull: true },
    { name: 'publish_at', type: 'timestamp', notNull: true },
    { name: 'created_at', type: 'timestamp', notNull: true },
  ],
  indexes: [
    // 一条目一计划：唯一索引保证（用 id 做主键才能走 update/delete，见 storage 契约）
    { name: 'ux_sched_entry', columns: ['tenant_id', 'entry_id'], unique: true },
    // 轮询按 publish_at 取到期项
    { name: 'ix_sched_due', columns: ['publish_at'] },
  ],
  schema: {
    columns: {
      entryId: 'entry_id',
      tenantId: 'tenant_id',
      publishAt: 'publish_at',
      createdAt: 'created_at',
    },
  },
};

/** 计划行的物理形态（filters 走物理列名） */
interface ScheduleRow extends ScheduleItem {
  id: string;
}

export interface SchedulerModuleOptions {
  /**
   * 轮询间隔（毫秒）。默认 30s——定时发布的精度要求不高。
   * 传 0 关闭自动轮询（测试或由外部驱动时用）。
   */
  intervalMs?: number;
}

export function schedulerModule(options: SchedulerModuleOptions = {}): PlatformModule {
  const intervalMs = options.intervalMs ?? 30_000;
  let driver: StorageDriver | undefined;
  let content: ContentService | undefined;
  let timer: NodeJS.Timeout | undefined;

  const deps = (): { driver: StorageDriver; content: ContentService } => {
    if (!driver || !content) throw new Error('[scheduler] 模块未就绪');
    return { driver, content };
  };

  const service: ScheduleService = {
    async schedule(input): Promise<ScheduleItem> {
      const { driver: d } = deps();
      const now = Date.now();
      return d.transaction(async (tx) => {
        const existing = await tx.findOne<ScheduleRow>({
          table: TABLE,
          where: { tenantId: input.tenantId, entryId: input.entryId },
        });
        if (existing) {
          // 覆盖：同一 entry 只保留最后一个计划
          await tx.update(TABLE, existing.id, { ...input, createdAt: now } as Partial<ScheduleRow>);
          return { ...input, createdAt: now };
        }
        const row: ScheduleRow = { id: newId(), ...input, createdAt: now };
        await tx.insert(TABLE, row);
        return { ...input, createdAt: now };
      });
    },

    async cancel(entryId, tenantId): Promise<void> {
      const { driver: d } = deps();
      await d.transaction(async (tx) => {
        // 无计划时静默返回，便于 UI 无脑调用
        const existing = await tx.findOne<ScheduleRow>({
          table: TABLE,
          where: { tenantId, entryId },
        });
        if (existing) await tx.delete(TABLE, existing.id);
      });
    },

    async get(entryId, tenantId): Promise<ScheduleItem | null> {
      const { driver: d } = deps();
      return d.transaction((tx) =>
        tx.findOne<ScheduleItem>({ table: TABLE, where: { tenantId, entryId } })
      );
    },

    async list(tenantId): Promise<ScheduleItem[]> {
      const { driver: d } = deps();
      return d.transaction((tx) =>
        tx.find<ScheduleItem>({
          table: TABLE,
          where: { tenantId },
          orderBy: [{ field: 'publishAt', dir: 'asc' }],
        })
      );
    },
  };

  /** 扫描到期计划并发布；单条失败不阻断其余 */
  const tick = async (): Promise<void> => {
    const { driver: d, content: c } = deps();
    const due = await d.transaction((tx) =>
      tx.find<ScheduleRow>({
        table: TABLE,
        // publish_at 是物理列名（QueryFilter 走物理路径，与 data.xxx 同理）
        filters: [{ field: 'publish_at', op: 'lte', value: Date.now() }],
      })
    );

    for (const row of due) {
      try {
        await c.update(row.entryId, {
          tenantId: row.tenantId,
          data: { status: 'published' },
          actor: systemPrincipal(row.tenantId),
        });
      } catch {
        // 条目已被删除等：忽略错误，照样清理计划（否则会永远重试）
      }
      await d.transaction((tx) => tx.delete(TABLE, row.id));
    }
  };

  return {
    name: 'scheduler',
    dependsOn: ['storage', 'content'],

    async setup({ registry }): Promise<void> {
      driver = registry.require<StorageDriver>(Tokens.Storage);
      content = registry.require<ContentService>(Tokens.Content);
      await driver.createTable(SCHEDULES);

      if (intervalMs > 0) {
        timer = setInterval(() => {
          void tick().catch(() => undefined); // 轮询失败不冒泡（下一轮重试）
        }, intervalMs);
        timer.unref?.(); // 不阻止进程退出
      }

      registry.provide<ScheduleService>(Tokens.Schedule, service);
    },

    async teardown(): Promise<void> {
      if (timer) clearInterval(timer);
      timer = undefined;
      driver = undefined;
      content = undefined;
    },
  };
}
