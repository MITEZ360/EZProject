// kernel/contracts/identity.contract.ts
// 身份契约：认证（谁）与令牌（JWT 访问令牌 + 可撤销刷新令牌）。
// 权限判定（能做什么）在 authz.contract.ts —— 两者分离是安全设计的基本要求。

import type { Principal } from '../primitives/principal.js';

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  /** 角色 slug 列表（RBAC：权限经角色聚合） */
  roles: string[];
  /** 'active' | 'disabled' */
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface TokenPair {
  /** JWT：短时效，自包含（sub/tenantId/roles/exp） */
  accessToken: string;
  /** 刷新令牌：随机串，哈希落库、可撤销、**每次刷新轮换** */
  refreshToken: string;
  /** 访问令牌有效秒数 */
  expiresIn: number;
}

export interface AuthzPermission {
  /** 资源：内容类型 slug 或 '*' */
  resource: string;
  /** 动作列表：'read' | 'create' | 'update' | 'delete' 或 '*' */
  actions: string[];
  /** scope：字段级拒绝（写路径剥离 / 读路径裁剪） */
  deniedFields?: string[];
}

export interface Role {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  permissions: AuthzPermission[];
  /** 内置角色不可删除 */
  builtin?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface IdentityService {
  /** 登录：邮箱 + 密码 → 令牌对；失败返回 null（不区分"用户不存在/密码错"） */
  login(tenantId: string, email: string, password: string): Promise<TokenPair | null>;
  /** 用刷新令牌换新令牌对（轮换：旧 refresh 立即失效） */
  refresh(tenantId: string, refreshToken: string): Promise<TokenPair | null>;
  /** 登出：撤销刷新令牌 */
  logout(refreshToken: string): Promise<void>;
  /** 校验访问令牌 → 主体（无效返回 null） */
  verifyAccessToken(token: string): Promise<Principal | null>;

  createUser(
    input: { tenantId: string; email: string; name: string; password: string; roles: string[] }
  ): Promise<User>;
  listUsers(tenantId: string): Promise<User[]>;
  /** 更新用户（角色/状态/姓名）；密码单独走 setPassword */
  updateUser(id: string, tenantId: string, patch: { name?: string; roles?: string[]; status?: string }): Promise<User>;
  setPassword(id: string, tenantId: string, password: string): Promise<void>;

  upsertRole(role: Omit<Role, 'id' | 'createdAt' | 'updatedAt'>): Promise<Role>;
  listRoles(tenantId: string): Promise<Role[]>;
  deleteRole(slug: string, tenantId: string): Promise<void>;
}
