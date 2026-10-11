// modules/media/index.ts
// 媒体模块（通用能力）：资产存取策略（local 已实现，s3 预留）。
// 内容只存 asset id（铁律）；本模块负责二进制与元信息。

import { createLocalAssetStore, MEDIA_DDL } from './internal/local.store.js';
import type { AssetStore } from '@kernel/contracts/asset.contract.js';
import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import { Tokens } from '@kernel/registry.js';

export interface MediaModuleOptions {
  /** 存储策略；默认 local（文件落磁盘） */
  dialect?: 'local' | 's3';
  /** local 策略的根目录（默认 ./data/media） */
  root?: string;
}

export function mediaModule(options: MediaModuleOptions = {}): PlatformModule {
  return {
    name: 'media',
    dependsOn: ['storage'],

    async setup({ registry }): Promise<void> {
      const dialect = options.dialect ?? 'local';
      if (dialect !== 'local') {
        throw new Error(`[media] ${dialect} 策略未实现（阶段三按需补）。契约已就绪。`);
      }
      const driver = registry.require<StorageDriver>(Tokens.Storage);
      driver.registerTable('assets', {
        columns: { tenantId: 'tenant_id', contentType: 'content_type', createdAt: 'created_at' },
        jsonColumns: ['meta'],
      });
      await driver.transaction((tx) => tx.exec(MEDIA_DDL));

      const store = createLocalAssetStore(driver, options.root ?? './data/media');
      registry.provide<AssetStore>(Tokens.Assets, store);
    },
  };
}
