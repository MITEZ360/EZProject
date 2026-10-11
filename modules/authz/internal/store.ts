// modules/authz/internal/store.ts
// authz 模块的私有表与数据访问（经 StorageDriver 契约；表结构在本模块登记）。

import type { StorageDriver, TableDef } from '@kernel/contracts/storage.contract.js';
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

export interface RefreshRow {
  id: string;
  userId: string;
  tenantId: string;
  tokenHash: string;
  expiresAt: number;
  revokedAt: number; // 0 = 有效
  createdAt: number;
}

/**
 * authz 私有表声明（**声明式建表**：物理类型由存储层按方言决定，
 * 模块不再写 TEXT / BIGINT / INTEGER——那正是"只在某个方言上炸"的来源）。
 *
 * `builtin` 声明为 `bool`：SQLite 落 INTEGER(0/1)，PG 落原生 BOOLEAN（契约 6.5）。
 */
const TABLES: TableDef[] = [
  {
    table: 'auth_users',
    columns: [
      { name: 'id', type: 'text', primaryKey: true },
      { name: 'tenant_id', type: 'text', notNull: true },
      { name: 'email', type: 'text', notNull: true },
      { name: 'name', type: 'text', notNull: true },
      { name: 'password_hash', type: 'text', notNull: true },
      { name: 'roles', type: 'json', notNull: true },
      { name: 'status', type: 'text', notNull: true },
      { name: 'created_at', type: 'timestamp', notNull: true },
      { name: 'updated_at', type: 'timestamp', notNull: true },
    ],
    indexes: [{ name: 'ux_auth_users_email', columns: ['tenant_id', 'email'], unique: true }],
    schema: {
      columns: {
        tenantId: 'tenant_id',
        passwordHash: 'password_hash',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      jsonColumns: ['roles'],
    },
  },
  {
    table: 'auth_roles',
    columns: [
      { name: 'id', type: 'text', primaryKey: true },
      { name: 'tenant_id', type: 'text', notNull: true },
      { name: 'slug', type: 'text', notNull: true },
      { name: 'name', type: 'text', notNull: true },
      { name: 'permissions', type: 'json', notNull: true },
      { name: 'builtin', type: 'bool', notNull: true },
      { name: 'created_at', type: 'timestamp', notNull: true },
      { name: 'updated_at', type: 'timestamp', notNull: true },
    ],
    indexes: [{ name: 'ux_auth_roles_slug', columns: ['tenant_id', 'slug'], unique: true }],
    schema: {
      columns: { tenantId: 'tenant_id', createdAt: 'created_at', updatedAt: 'updated_at' },
      jsonColumns: ['permissions'],
    },
  },
  {
    table: 'auth_refresh_tokens',
    columns: [
      { name: 'id', type: 'text', primaryKey: true },
      { name: 'user_id', type: 'text', notNull: true },
      { name: 'tenant_id', type: 'text', notNull: true },
      { name: 'token_hash', type: 'text', notNull: true },
      { name: 'expires_at', type: 'timestamp', notNull: true },
      { name: 'revoked_at', type: 'timestamp', notNull: true }, // 0 = 有效
      { name: 'created_at', type: 'timestamp', notNull: true },
    ],
    indexes: [{ name: 'ix_auth_refresh_hash', columns: ['token_hash'] }],
    schema: {
      columns: {
        userId: 'user_id',
        tenantId: 'tenant_id',
        tokenHash: 'token_hash',
        expiresAt: 'expires_at',
        revokedAt: 'revoked_at',
        createdAt: 'created_at',
      },
    },
  },
];

/** 建表（并登记表结构）。幂等，模块 setup 时调用 */
export async function migrateAuthz(driver: StorageDriver): Promise<void> {
  for (const def of TABLES) await driver.createTable(def);
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
    await driver.transaction((tx) => tx.insert('auth_roles', row));
  },

  async updateRole(driver: StorageDriver, id: string, patch: Partial<RoleRow>): Promise<void> {
    await driver.transaction((tx) => tx.update('auth_roles', id, patch));
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
