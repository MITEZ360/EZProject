// kernel/bootstrap.ts
// 内核生命周期：加载给定模块子集并启动。
// 关键性质：只加载任意子集都能启动（可拔插性）；依赖顺序由 dependsOn 决定。

import { createEventBus } from './events/bus.js';
import type { PlatformModule } from './contracts/module.contract.js';
import { createRegistry, type Registry } from './registry.js';
import type { EventBus } from './events/types.js';

export interface BootstrapOptions {
  /** 要加载的模块（只给子集也必须能启动） */
  modules: PlatformModule[];
  config?: Record<string, unknown>;
  /** 用于启动日志 */
  logger?: Logger;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface App {
  registry: Registry;
  events: EventBus;
  config: Record<string, unknown>;
  isReady(): boolean;
  /** 已加载模块名（有序） */
  loadedModules(): string[];
  /** 停止：逆序 teardown，保证可拔插 */
  stop(): Promise<void>;
}

const defaultLogger: Logger = {
  info: () => {},
  error: () => {},
};

/** 按 dependsOn 做拓扑排序；缺失依赖则报错 */
function resolveOrder(modules: PlatformModule[]): PlatformModule[] {
  const byName = new Map(modules.map((m) => [m.name, m]));
  const visited = new Set<string>();
  const order: PlatformModule[] = [];

  const visit = (mod: PlatformModule, stack: string[]): void => {
    if (visited.has(mod.name)) return;
    if (stack.includes(mod.name)) {
      throw new Error(`[kernel] 模块依赖成环: ${[...stack, mod.name].join(' -> ')}`);
    }
    for (const dep of mod.dependsOn ?? []) {
      const depMod = byName.get(dep);
      if (!depMod) {
        throw new Error(`[kernel] 模块 ${mod.name} 依赖缺失: ${dep}`);
      }
      visit(depMod, [...stack, mod.name]);
    }
    visited.add(mod.name);
    order.push(mod);
  };

  for (const mod of modules) visit(mod, []);
  return order;
}

export async function bootstrap(options: BootstrapOptions): Promise<App> {
  const logger = options.logger ?? defaultLogger;
  const registry = createRegistry();
  const events = createEventBus();
  const config = options.config ?? {};

  const ordered = resolveOrder(options.modules);
  const loaded: PlatformModule[] = [];
  let ready = false;

  try {
    for (const mod of ordered) {
      await mod.setup({ registry, events, config });
      loaded.push(mod);
      logger.info(`[kernel] 已挂载模块: ${mod.name}`);
    }
    ready = true;
    logger.info('[kernel] 启动完成', { modules: loaded.map((m) => m.name) });
  } catch (e) {
    logger.error('[kernel] 启动失败', { error: (e as Error).message });
    // 失败时回滚已加载模块
    for (const mod of [...loaded].reverse()) {
      try {
        await mod.teardown?.();
      } catch {
        /* 回滚失败不掩盖原始错误 */
      }
    }
    throw e;
  }

  return {
    registry,
    events,
    config,
    isReady: () => ready,
    loadedModules: () => loaded.map((m) => m.name),
    async stop(): Promise<void> {
      for (const mod of [...loaded].reverse()) {
        await mod.teardown?.();
      }
      loaded.length = 0;
      ready = false;
      logger.info('[kernel] 已停止');
    },
  };
}
