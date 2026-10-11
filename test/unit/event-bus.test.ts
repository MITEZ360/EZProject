import { describe, it, expect } from 'vitest';
import { createEventBus } from '@kernel/events/bus.js';
import type { DomainEvent } from '@kernel/events/types.js';

const ev = (name: string, payload: unknown = {}): DomainEvent => ({
  name,
  tenantId: 'tenant01',
  payload,
  occurredAt: Date.now(),
});

describe('event bus', () => {
  it('publish 触发订阅者', async () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe('content.entry.published', (e) => {
      seen.push(e.name);
    });
    await bus.publish(ev('content.entry.published'));
    expect(seen).toEqual(['content.entry.published']);
  });

  it('同名多订阅者都收到；不同名不串扰', async () => {
    const bus = createEventBus();
    let a = 0;
    let b = 0;
    let other = 0;
    bus.subscribe('x.y.z', () => { a++; });
    bus.subscribe('x.y.z', () => { b++; });
    bus.subscribe('other.event', () => { other++; });
    await bus.publish(ev('x.y.z'));
    expect([a, b, other]).toEqual([1, 1, 0]);
  });

  it('取消订阅后不再收到', async () => {
    const bus = createEventBus();
    let n = 0;
    const off = bus.subscribe('e', () => { n++; });
    await bus.publish(ev('e'));
    off();
    await bus.publish(ev('e'));
    expect(n).toBe(1);
  });

  it('once 只触发一次', async () => {
    const bus = createEventBus();
    let n = 0;
    bus.subscribe('e', () => { n++; }, { once: true });
    await bus.publish(ev('e'));
    await bus.publish(ev('e'));
    expect(n).toBe(1);
  });
});
