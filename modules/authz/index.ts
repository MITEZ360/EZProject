// modules/authz/index.ts
// 身份与权限模块（通用能力）：
// - IdentityService：JWT 访问令牌 + 可撤销/轮换刷新令牌 + 用户/角色管理
// - AuthzService：RBAC（角色→权限点，'*' 通配）+ scope（字段级 deniedFields）
// 认证（谁）与授权（能做什么）分离，均由本模块实现，经内核契约对外。

import type { PlatformModule } from '@kernel/contracts/module.contract.js';
import type { StorageDriver } from '@kernel/contracts/storage.contract.js';
import type { IdentityService, Role, TokenPair, User } from '@kernel/contracts/identity.contract.js';
import type { AuthzAction, AuthzDecision, AuthzService } from '@kernel/contracts/authz.contract.js';
import type { Principal } from '@kernel/primitives/principal.js';
import { newId } from '@kernel/primitives/id.js';
import { Tokens } from '@kernel/registry.js';
import { randomBytes } from 'node:crypto';
import { hashPassword, newRefreshToken, sha256, signJwt, verifyJwt, verifyPassword } from './internal/crypto.js';
import { migrateAuthz, registerAuthzTables, store, type RoleRow, type UserRow } from './internal/store.js';

export interface AuthzModuleOptions {
  /** JWT 签名密钥；生产必须显式配置（缺省时启动随机生成，仅限开发） */
  jwtSecret?: string;
  /** 访问令牌有效期（秒），默认 15 分钟 */
  accessTtlSeconds?: number;
  /** 刷新令牌有效期（秒），默认 30 天 */
  refreshTtlSeconds?: number;
}

const DEFAULT_ACCESS_TTL = 900;
const DEFAULT_REFRESH_TTL = 30 * 24 * 3600;

/** 内置管理员角色：全资源全动作 */
export const ADMIN_ROLE: Omit<Role, 'id' | 'createdAt' | 'updatedAt'> = {
  tenantId: '*',
  slug: 'admin',
  name: '管理员',
  permissions: [{ resource: '*', actions: ['*'] }],
  builtin: true,
};

export function authzModule(options: AuthzModuleOptions = {}): PlatformModule {
  let driver: StorageDriver | undefined;
  let secret = '';
  let accessTtl = DEFAULT_ACCESS_TTL;
  let refreshTtl = DEFAULT_REFRESH_TTL;

  const toUser = (row: UserRow): User => ({
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    name: row.name,
    roles: row.roles,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const toRole = (row: RoleRow): Role => ({
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    name: row.name,
    permissions: row.permissions,
    builtin: Boolean(row.builtin), // 落库为 INTEGER（契约 6.5）
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const driver_ = (): StorageDriver => {
    if (!driver) throw new Error('[authz] 模块未就绪');
    return driver;
  };

  const issueTokens = async (user: UserRow): Promise<TokenPair> => {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = signJwt(
      { sub: user.id, tenantId: user.tenantId, roles: user.roles, iat: now, exp: now + accessTtl, typ: 'access' },
      secret
    );
    const { token, hash } = newRefreshToken();
    await store.insertRefresh(driver_(), {
      id: newId(),
      userId: user.id,
      tenantId: user.tenantId,
      tokenHash: hash,
      expiresAt: Date.now() + refreshTtl * 1000,
      revokedAt: 0,
      createdAt: Date.now(),
    });
    return { accessToken, refreshToken: token, expiresIn: accessTtl };
  };

  const identity: IdentityService = {
    async login(tenantId, email, password) {
      const row = await store.findUserByEmail(driver_(), tenantId, email);
      // 用户不存在也走一次哈希比较，避免时序侧信道区分"不存在/密码错"
      if (!row || row.status !== 'active' || !verifyPassword(password, row.passwordHash)) return null;
      return issueTokens(row);
    },

    async refresh(tenantId, refreshToken) {
      const hash = sha256(refreshToken);
      const rec = await store.findRefreshByHash(driver_(), hash);
      if (!rec || rec.tenantId !== tenantId) return null;
      if (rec.revokedAt !== 0) {
        // 已撤销的 refresh 被再次使用 = 令牌泄漏信号：撤销该用户全部会话
        await store.revokeAllForUser(driver_(), rec.userId, Date.now());
        return null;
      }
      if (rec.expiresAt <= Date.now()) return null;
      const user = await store.findUserById(driver_(), rec.userId, tenantId);
      if (!user || user.status !== 'active') return null;

      await store.revokeRefresh(driver_(), rec.id, Date.now()); // 轮换：旧令牌立即失效
      return issueTokens(user);
    },

    async logout(refreshToken) {
      const rec = await store.findRefreshByHash(driver_(), sha256(refreshToken));
      if (rec && rec.revokedAt === 0) await store.revokeRefresh(driver_(), rec.id, Date.now());
    },

    async verifyAccessToken(token) {
      const claims = verifyJwt(token, secret);
      if (!claims) return null;
      return { id: claims.sub, tenantId: claims.tenantId, kind: 'user', capabilities: claims.roles };
    },

    async createUser(input) {
      const now = Date.now();
      const row: UserRow = {
        id: newId(),
        tenantId: input.tenantId,
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: hashPassword(input.password),
        roles: input.roles,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      await store.insertUser(driver_(), row);
      return toUser(row);
    },

    async listUsers(tenantId) {
      return (await store.listUsers(driver_(), tenantId)).map(toUser);
    },

    async updateUser(id, tenantId, patch) {
      const cur = await store.findUserById(driver_(), id, tenantId);
      if (!cur) throw Object.assign(new Error(`[authz] 用户不存在: ${id}`), { name: 'E_NOT_FOUND' });
      await store.updateUser(driver_(), id, { ...patch, updatedAt: Date.now() });
      if (patch.status === 'disabled') await store.revokeAllForUser(driver_(), id, Date.now());
      return toUser({ ...cur, ...patch, updatedAt: Date.now() });
    },

    async setPassword(id, tenantId, password) {
      const cur = await store.findUserById(driver_(), id, tenantId);
      if (!cur) throw Object.assign(new Error(`[authz] 用户不存在: ${id}`), { name: 'E_NOT_FOUND' });
      await store.updateUser(driver_(), id, { passwordHash: hashPassword(password), updatedAt: Date.now() });
      await store.revokeAllForUser(driver_(), id, Date.now()); // 改密后强制重登
    },

    async upsertRole(role) {
      const existing = await store.findRole(driver_(), role.tenantId, role.slug);
      const now = Date.now();
      if (existing) {
        await store.updateRole(driver_(), existing.id, {
          name: role.name,
          permissions: role.permissions,
          updatedAt: now,
        });
        return toRole({ ...existing, name: role.name, permissions: role.permissions, updatedAt: now });
      }
      const row: RoleRow = {
        id: newId(),
        tenantId: role.tenantId,
        slug: role.slug,
        name: role.name,
        permissions: role.permissions,
        builtin: role.builtin ?? false,
        createdAt: now,
        updatedAt: now,
      };
      await store.insertRole(driver_(), row);
      return toRole(row);
    },

    async listRoles(tenantId) {
      return (await store.listRoles(driver_(), tenantId)).map(toRole);
    },

    async deleteRole(slug, tenantId) {
      const row = await store.findRole(driver_(), tenantId, slug);
      if (!row) return;
      if (row.builtin) throw Object.assign(new Error('[authz] 内置角色不可删除'), { name: 'E_CONFLICT' });
      await store.deleteRole(driver_(), row.id);
    },
  };

  const authz: AuthzService = {
    async can(principal: Principal, action: AuthzAction): Promise<AuthzDecision> {
      // 引导令牌主体（MANAGE_TOKEN）：仅用于初始引导，全权
      if (principal.kind === 'bootstrap' || principal.kind === 'system') return { allowed: true };

      const roleSlugs = principal.capabilities ?? [];
      const roles = await store.listRoles(driver_(), principal.tenantId);
      const mine = roles.filter((r) => roleSlugs.includes(r.slug));
      if (mine.length === 0) return { allowed: false, reason: 'E_NO_ROLE' };

      const deniedFields = new Set<string>();
      let allowed = false;
      for (const role of mine) {
        for (const p of role.permissions) {
          const resourceOk = p.resource === '*' || p.resource === action.resource;
          const actionOk = p.actions.includes('*') || p.actions.includes(action.action);
          if (resourceOk && actionOk) {
            allowed = true;
            for (const f of p.deniedFields ?? []) deniedFields.add(f);
          }
        }
      }
      if (!allowed) return { allowed: false, reason: 'E_FORBIDDEN' };
      return deniedFields.size > 0
        ? { allowed: true, deniedFields: [...deniedFields] }
        : { allowed: true };
    },
  };

  return {
    name: 'authz',
    dependsOn: ['storage'],

    async setup({ registry, config }): Promise<void> {
      driver = registry.require<StorageDriver>(Tokens.Storage);
      secret =
        options.jwtSecret ??
        (config['jwtSecret'] as string | undefined) ??
        process.env['JWT_SECRET'] ??
        '';
      if (!secret) {
        secret = randomBytes(32).toString('hex');
        console.warn('[authz] 未配置 JWT_SECRET：已生成临时密钥（重启后令牌失效，仅限开发）');
      }
      accessTtl = options.accessTtlSeconds ?? DEFAULT_ACCESS_TTL;
      refreshTtl = options.refreshTtlSeconds ?? DEFAULT_REFRESH_TTL;

      registerAuthzTables(driver);
      await migrateAuthz(driver);

      registry.provide<IdentityService>(Tokens.Identity, identity);
      registry.provide<AuthzService>(Tokens.Authz, authz);
    },

    async teardown(): Promise<void> {
      driver = undefined;
    },
  };
}

export { ensureAdminRoleFor } from './internal/bootstrap.js';
