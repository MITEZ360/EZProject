// modules/settings/index.ts
// 系统设置模块（通用能力）：per-tenant KV 存储（值任意 JSON）。
// 私有表 settings 经**声明式建表**创建（物理类型由存储层按方言落地）。

import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import type { StorageDriver, TableDef } from '@kernel/contracts/storage.contract.js';
import type { SettingItem, SettingsService } from '@kernel/contracts/settings.contract.js';
import { newId } from '@kernel/primitives/id.js';
import { Tokens } from '@kernel/registry.js';

const SETTINGS_TABLE: TableDef = {
  table: 'settings',
  columns: [
    { name: 'id', type: 'text', primaryKey: true },
    { name: 'tenant_id', type: 'text', notNull: true },
    { name: 'key', type: 'text', notNull: true },
    { name: 'value', type: 'json', notNull: true },
    { name: 'updated_at', type: 'timestamp', notNull: true },
  ],
  indexes: [{ name: 'ix_settings_tenant', columns: ['tenant_id', 'key'] }],
  schema: {
    columns: { tenantId: 'tenant_id', updatedAt: 'updated_at' },
    jsonColumns: ['value'],
  },
};

interface SettingRow {
  id: string;
  tenantId: string;
  key: string;
  value: unknown;
  updatedAt: number;
}

const KEY_RE = /^[a-zA-Z0-9._-]{1,64}$/;

export function settingsModule(): PlatformModule {
  let driver: StorageDriver | undefined;

  const service: SettingsService = {
    async get(tenantId: string, key: string): Promise<SettingItem | null> {
      if (!driver) throw new Error('[settings] 模块未就绪');
      const row = await driver.transaction((tx) =>
        tx.findOne<SettingRow>({ table: 'settings', where: { tenantId, key } })
      );
      return row ? { key: row.key, value: row.value, updatedAt: row.updatedAt } : null;
    },

    async set(tenantId: string, key: string, value: unknown): Promise<void> {
      if (!KEY_RE.test(key)) throw new Error(`[settings] 非法设置键: ${key}`);
      if (value === undefined) throw new Error('[settings] 设置值不能为 undefined');
      const now = Date.now();
      await driver!.transaction(async (tx) => {
        const existing = await tx.findOne<SettingRow>({
          table: 'settings',
          where: { tenantId, key },
        });
        if (existing) {
          await tx.update<SettingRow>('settings', existing.id, { value, updatedAt: now });
        } else {
          await tx.insert('settings', { id: newId(), tenantId, key, value, updatedAt: now });
        }
      });
    },

    async list(tenantId: string): Promise<SettingItem[]> {
      if (!driver) throw new Error('[settings] 模块未就绪');
      const rows = await driver.transaction((tx) =>
        tx.find<SettingRow>({ table: 'settings', where: { tenantId } })
      );
      return rows
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((r) => ({ key: r.key, value: r.value, updatedAt: r.updatedAt }));
    },
  };

  return {
    name: 'settings',
    dependsOn: ['storage'],

    async setup({ registry }): Promise<void> {
      driver = registry.require<StorageDriver>(Tokens.Storage);
      await driver.createTable(SETTINGS_TABLE);
      registry.provide<SettingsService>(Tokens.Settings, service);
    },

    async teardown(): Promise<void> {
      driver = undefined;
    },
  };
}
