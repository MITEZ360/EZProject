// kernel/contracts/settings.contract.ts
// 系统设置能力契约：per-tenant KV（值任意 JSON）。settings 模块实现。

export interface SettingItem {
  key: string;
  value: unknown;
  /** epoch 毫秒整数 */
  updatedAt: number;
}

export interface SettingsService {
  get(tenantId: string, key: string): Promise<SettingItem | null>;
  set(tenantId: string, key: string, value: unknown): Promise<void>;
  list(tenantId: string): Promise<SettingItem[]>;
}
