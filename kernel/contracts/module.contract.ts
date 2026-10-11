// kernel/contracts/module.contract.ts
// 模块接入契约（扩展点插槽）：内核只认这个。
// 依据：engineering-spec 4.5。

import type { EventBus } from '../events/types.js';
import type { Registry } from '../registry.js';

export interface ModuleContext {
  registry: Registry;
  events: EventBus;
  config: Record<string, unknown>;
}

export interface PlatformModule {
  /** 'content' | 'storage' | 'authz' ... */
  name: string;
  /** 只依赖名字，不依赖实现 */
  dependsOn?: string[];
  setup(ctx: ModuleContext): Promise<void>;
  /** 保证可拔插 */
  teardown?(): Promise<void>;
}
