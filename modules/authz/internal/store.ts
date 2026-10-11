// modules/authz/internal/store.ts
// authz 模块的私有表与数据访问（经 StorageDriver 契约；表结构在本模块登记）。

import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import type { Role } from '@kernel/contracts/identity.contract.js';

export interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  passwordHash: string;
  roles: string[];
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface RoleRow {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  permissions: Role['permissions'];
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 布尔列落库为 0/1。
 * PG 是强类型：整数列**拒绝** JS boolean（`column "builtin" is of type integer
 * but expression is of type boolean`），而 SQLite 会静默转成 0/1——
 * 不做转换就只在 PG 上炸。转换收敛在落库边界，调用方保持 boolean 语义。
 */
const toDbRole = (row: RoleRow): Record<string, unknown> => ({
  ...row,
  builtin: row.builtin ? 1 : 0,
});

const toDbPatch = (patch: Partial<RoleRow>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...patch };
  if (typeof out['builtin'] === 'boolean') out['builtin'] = out['builtin'] ? 1 : 0;
  return out;
};

export interface RefreshRow {
  id: string;
  userId: string;
  tenantId: string;
  tokenHash: string;
  expiresAt: number;
  revokedAt: number; // 0 = 有效
  createdAt: number;
}

// 时间戳一律 BIGINT（epoch 毫秒超出 PG INTEGER(32 位)；SQLite 下等价）。
// builtin 保持 INTEGER：布尔落库为 0/1，三方言一致
//   （PG 的既不是 BOOLEAN 也不是 INTEGER——契约 6.5 的 bool 映射是 BOOLEAN，
//    此处为最小修复采用数字，见 dev-log 遗留项）。
const DDL = `
CREATE TABLE IF NOT EXISTS auth_users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  roles         TEXT NOT NULL,   -- JSON string[]
  status        TEXT NOT NULL,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_users_email ON auth_users (tenant_id, email);
CREATE TABLE IF NOT EXISTS auth_roles (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  permissions TEXT NOT NULL,     -- JSON
  builtin     INTEGER NOT NULL,  -- 0/1
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_roles_slug ON auth_roles (tenant_id, slug);
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  tenant_id  TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT NOT NULL,   -- 0 = 有效
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_auth_refresh_hash ON auth_refresh_tokens (token_hash);
`;

export function registerAuthzTables(driver: StorageDriver): void {
  driver.registerTable('auth_users', {
    columns: { tenantId: 'tenant_id', passwordHash: 'password_hash', createdAt: 'created_at', updatedAt: 'updated_at' },
    jsonColumns: ['roles'],
  });
  driver.registerTable('auth_roles', {
    columns: { tenantId: 'tenant_id', createdAt: 'created_at', updatedAt: 'updated_at' },
    jsonColumns: ['permissions'],
  });
  driver.registerTable('auth_refresh_tokens', {
    columns: { userId: 'user_id', tenantId: 'tenant_id', tokenHash: 'token_hash', expiresAt: 'expires_at', revokedAt: 'revoked_at', createdAt: 'created_at' },
  });
}

export async function migrateAuthz(driver: StorageDriver): Promise<void> {
  await driver.transaction(async (tx) => tx.exec(DDL));
}

export const store = {
  async findUserByEmail(driver: StorageDriver, tenantId: string, email: string): Promise<UserRow | null> {
    return driver.transaction((tx) =>
      tx.findOne<UserRow>({ table: 'auth_users', where: { tenantId, email: email.toLowerCase() } })
    );
  },

  async findUserById(driver: StorageDriver, id: string, tenantId: string): Promise<UserRow | null> {
    return driver.transaction((tx) =>
      tx.findOne<UserRow>({ table: 'auth_users', where: { id, tenantId } })
    );
  },

  async insertUser(driver: StorageDriver, row: UserRow): Promise<void> {
    await driver.transaction((tx) => tx.insert('auth_users', row));
  },

  async updateUser(driver: StorageDriver, id: string, patch: Partial<UserRow>): Promise<void> {
    await driver.transaction((tx) => tx.update('auth_users', id, patch));
  },

  async listUsers(driver: StorageDriver, tenantId: string): Promise<UserRow[]> {
    return driver.transaction((tx) =>
      tx.find<UserRow>({ table: 'auth_users', where: { tenantId }, orderBy: [{ field: 'createdAt', dir: 'asc' }] })
    );
  },

  async findRole(driver: StorageDriver, tenantId: string, slug: string): Promise<RoleRow | null> {
    return driver.transaction((tx) =>
      tx.findOne<RoleRow>({ table: 'auth_roles', where: { tenantId, slug } })
    );
  },

  async listRoles(driver: StorageDriver, tenantId: string): Promise<RoleRow[]> {
    return driver.transaction((tx) =>
      tx.find<RoleRow>({ table: 'auth_roles', where: { tenantId }, orderBy: [{ field: 'slug', dir: 'asc' }] })
    );
  },

  async insertRole(driver: StorageDriver, row: RoleRow): Promise<void> {
    await driver.transaction((tx) => tx.insert('auth_roles', toDbRole(row)));
  },

  async updateRole(driver: StorageDriver, id: string, patch: Partial<RoleRow>): Promise<void> {
    await driver.transaction((tx) => tx.update('auth_roles', id, toDbPatch(patch)));
  },

  async deleteRole(driver: StorageDriver, id: string): Promise<void> {
    await driver.transaction((tx) => tx.delete('auth_roles', id));
  },

  async insertRefresh(driver: StorageDriver, row: RefreshRow): Promise<void> {
    await driver.transaction((tx) => tx.insert('auth_refresh_tokens', row));
  },

  async findRefreshByHash(driver: StorageDriver, tokenHash: string): Promise<RefreshRow | null> {
    return driver.transaction((tx) =>
      tx.findOne<RefreshRow>({ table: 'auth_refresh_tokens', where: { tokenHash } })
    );
  },

  async revokeRefresh(driver: StorageDriver, id: string, at: number): Promise<void> {
    await driver.transaction((tx) => tx.update('auth_refresh_tokens', id, { revokedAt: at }));
  },

  /** 撤销某用户的全部刷新令牌（改密码/禁用时用） */
  async revokeAllForUser(driver: StorageDriver, userId: string, at: number): Promise<void> {
    const rows = await driver.transaction((tx) =>
      tx.find<RefreshRow>({ table: 'auth_refresh_tokens', where: { userId, revokedAt: 0 } })
    );
    for (const r of rows) await store.revokeRefresh(driver, r.id, at);
  },

};
