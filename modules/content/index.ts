// modules/content/index.ts
// 内容模块入口：实现 PlatformModule。
// 从注册表按契约取 StorageDriver（不 import storage 实现），装配 ContentService。

import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import type { EntityTypeDef } from '@kernel/primitives/entity.js';
import { systemPrincipal } from '@kernel/primitives/principal.js';
import type { CacheProvider } from '@kernel/contracts/cache.contract.js';
import { Tokens } from '@kernel/registry.js';
import { createContentService } from './internal/service.js';

export function contentModule(types: EntityTypeDef[] = []): PlatformModule {
  return {
    name: 'content',
    dependsOn: ['storage'],

    async setup({ registry, events }): Promise<void> {
      const driver = registry.require<StorageDriver>(Tokens.Storage);
      const cache = registry.get<CacheProvider>(Tokens.Cache); // 可选：缓存模块在场才失效
      const service = createContentService(driver, events, cache);

      // 代码内建类型：以 '*' 通配租户为种子落库（幂等 upsert）；
      // 运行时经 defineType 定义的类型落具体租户名下（决策 #26 逻辑 Schema）。
      for (const def of types) {
        await service.defineType(def, systemPrincipal('*'));
      }

      registry.provide<ContentService>(Tokens.Content, service);
    },
  };
}
