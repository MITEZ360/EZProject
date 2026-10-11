// kernel/events/bus.ts
// 事件总线实现（内核唯一实现）。
// 模块间只发/订事件，不直接调用（宪法三）。

import type { DomainEvent, EventBus, EventHandler, SubscribeOptions } from './types.js';

interface Subscription {
  handler: EventHandler;
  once: boolean;
}

export function createEventBus(): EventBus {
  const subs = new Map<string, Subscription[]>();

  return {
    async publish<T>(event: DomainEvent<T>): Promise<void> {
      const list = subs.get(event.name);
      if (!list || list.length === 0) return;

      // 快照，避免 handler 内订阅/取消导致迭代错乱
      const snapshot = [...list];
      for (const sub of snapshot) {
        if (sub.once) {
          const current = subs.get(event.name);
          if (current) {
            const idx = current.indexOf(sub);
            if (idx >= 0) current.splice(idx, 1);
          }
        }
        await sub.handler(event as DomainEvent<unknown>);
      }
    },

    subscribe<T>(
      name: string,
      handler: EventHandler<T>,
      options?: SubscribeOptions
    ): () => void {
      const list = subs.get(name) ?? [];
      const sub: Subscription = {
        handler: handler as EventHandler,
        once: options?.once ?? false,
      };
      list.push(sub);
      subs.set(name, list);

      return () => {
        const current = subs.get(name);
        if (!current) return;
        const idx = current.indexOf(sub);
        if (idx >= 0) current.splice(idx, 1);
      };
    },
  };
}
