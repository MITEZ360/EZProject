// kernel/contracts/schedule.contract.ts
// 定时发布（通用能力）：到点把条目置为已发布。
//
// 为什么不做成通用调度引擎：单机场景下一个到点轮询就够用，
// 引入调度器依赖与"定时发布"这个具体诉求不成比例。
// 契约只声明"设定 / 取消 / 查询计划"，何时执行由实现决定。

export interface ScheduleItem {
  entryId: string;
  tenantId: string;
  /** 条目类型 slug（执行时需按类型写回） */
  type: string;
  /** epoch 毫秒：到点执行 */
  publishAt: number;
  createdAt: number;
}

export interface ScheduleInput {
  entryId: string;
  tenantId: string;
  type: string;
  publishAt: number;
}

export interface ScheduleService {
  /** 设定或覆盖某条目的定时发布 */
  schedule(input: ScheduleInput): Promise<ScheduleItem>;
  /** 取消（无计划时静默返回，便于 UI 无脑调用） */
  cancel(entryId: string, tenantId: string): Promise<void>;
  /** 某条目的计划；无则 null */
  get(entryId: string, tenantId: string): Promise<ScheduleItem | null>;
  /** 某租户的全部计划（按时间升序） */
  list(tenantId: string): Promise<ScheduleItem[]>;
}
