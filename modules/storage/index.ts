// modules/storage/index.ts
// 存储模块入口：实现 PlatformModule。
// 职责：读配置 → 建驱动 → 迁移 → 把 StorageDriver 注册进注册表（供其他模块按契约取用）。

import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import type { StorageDriver, Dialect } from '@kernel/contracts/storage.contract.js';
import { Tokens } from '@kernel/registry.js';
import { createStorageDriver, type StorageConfig } from './factory.js';

export interface StorageModuleOptions {
  dialect?: Dialect;
  url?: string;
}

export function storageModule(options: StorageModuleOptions = {}): PlatformModule {
  let driver: StorageDriver | undefined;

  return {
    name: 'storage',

    async setup({ registry, config }): Promise<void> {
      const cfg: StorageConfig = {
        dialect: options.dialect ?? (config['dialect'] as Dialect | undefined) ?? 'sqlite',
        url: options.url ?? (config['url'] as string | undefined),
      };
      driver = createStorageDriver(cfg);
      await driver.migrate();
      registry.provide<StorageDriver>(Tokens.Storage, driver);
    },

    async teardown(): Promise<void> {
      await driver?.close();
      driver = undefined;
    },
  };
}
