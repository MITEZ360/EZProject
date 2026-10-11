// modules/authz/internal/bootstrap.ts
// 引导辅助：确保内置管理员角色存在（供场景/引导接口使用）。
import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import type { Role } from '@kernel/contracts/identity.contract.js';
import { newId } from '@kernel/primitives/id.js';
import { store } from './store.js';

export async function ensureAdminRoleFor(driver: StorageDriver, tenantId: string): Promise<Role> {
  const existing = await store.findRole(driver, tenantId, 'admin');
  if (existing) {
    return {
      id: existing.id, tenantId: existing.tenantId, slug: existing.slug, name: existing.name,
      permissions: existing.permissions, builtin: Boolean(existing.builtin),
      createdAt: existing.createdAt, updatedAt: existing.updatedAt,
    };
  }
  const now = Date.now();
  const row = {
    id: newId(), tenantId, slug: 'admin', name: '管理员',
    permissions: [{ resource: '*', actions: ['*'] }],
    builtin: true, createdAt: now, updatedAt: now,
  };
  await store.insertRole(driver, row);
  return { ...row, permissions: row.permissions as Role['permissions'] };
}
