// modules/content/index.ts
// 内容模块入口：实现 PlatformModule。
// 从注册表按契约取 StorageDriver（不 import storage 实现），装配 ContentService。

import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import type { ContentService } from '@kernel/contracts/content.contract.js';
import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import type { EntityTypeDef } from '@kernel/primitives/entity.js';
import { Tokens } from '@kernel/registry.js';
import { createContentService } from './internal/service.js';

export function contentModule(types: EntityTypeDef[] = []): PlatformModule {
  const typeTable = new Map<string, EntityTypeDef>();
  const key = (slug: string, tenantId: string) => `${tenantId}::${slug}`;

  return {
    name: 'content',
    dependsOn: ['storage'],

    async setup({ registry }): Promise<void> {
      const driver = registry.require<StorageDriver>(Tokens.Storage);

      for (const def of types) {
        // 阶段一：类型定义先做租户无关注册（默认租户通配）
        typeTable.set(key(def.slug, '*'), def);
      }

      const getTypeDef = (type: string, tenantId: string): EntityTypeDef | undefined =>
        typeTable.get(key(type, tenantId)) ?? typeTable.get(key(type, '*'));

      const service = createContentService(driver, getTypeDef);
      for (const def of types) await service.defineType(def);

      registry.provide<ContentService>(Tokens.Content, service);
    },
  };
}
