// modules/media/index.ts
// 媒体模块（通用能力）：资产存取策略（local 已实现，s3 预留）。
// 内容只存 asset id（铁律）；本模块负责二进制与元信息。

import { ASSETS_TABLE, createLocalAssetStore } from './internal/local.store.js';
import type { AssetStore } from '@kernel/contracts/asset.contract.js';
import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import { Tokens } from '@kernel/registry.js';

export interface MediaModuleOptions {
  /**
   * 策略提供方：'local'（默认，文件落磁盘）| 's3'（待补）。
   * 刻意**不叫 dialect**——"方言"在本项目专指数据库方言（`storage.Dialect`）。
   */
  provider?: 'local' | 's3';
  /** local 策略的根目录（默认 ./data/media） */
  root?: string;
}

type MediaProviderKind = NonNullable<MediaModuleOptions['provider']>;

/** 资产存储策略表（唯一选择点）：新增策略只加表项，不改逻辑 */
const MEDIA_STRATEGIES: Record<
  MediaProviderKind,
  (o: MediaModuleOptions, driver: StorageDriver) => AssetStore
> = {
  local: (o, driver) => createLocalAssetStore(driver, o.root ?? './data/media'),
  s3: () => {
    throw new Error('[media] s3 策略未实现（阶段三按需补）。契约已就绪。');
  },
};

export function mediaModule(options: MediaModuleOptions = {}): PlatformModule {
  return {
    name: 'media',
    dependsOn: ['storage'],

    async setup({ registry }): Promise<void> {
      const provider = options.provider ?? 'local';
      const driver = registry.require<StorageDriver>(Tokens.Storage);
      await driver.createTable(ASSETS_TABLE);

      registry.provide<AssetStore>(Tokens.Assets, MEDIA_STRATEGIES[provider](options, driver));
    },
  };
}
