// kernel/events/types.ts
// 事件基类型：模块间解耦的唯一通道。
// 命名规范：<模块名>.<实体>.<动作>（engineering-spec 7.4）。

export interface DomainEvent<T = unknown> {
  /** 'content.entry.published' */
  name: string;
  tenantId: string;
  payload: T;
  /** epoch 毫秒整数 */
  occurredAt: number;
}

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => Promise<void> | void;

export interface SubscribeOptions {
  /** 一次性订阅：触发后自动取消 */
  once?: boolean;
}

export interface EventBus {
  publish<T>(event: DomainEvent<T>): Promise<void>;
  subscribe<T>(name: string, handler: EventHandler<T>, options?: SubscribeOptions): () => void;
}
