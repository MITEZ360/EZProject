// test/boot/authz.test.ts
// 身份与权限（JWT + RBAC + scope）：
//   引导 → 登录 → JWT 写操作 → 细粒度角色 403 → scope 字段剥离 → 刷新轮换 → 登出撤销
//   以及：引导令牌不可越权、密码/用户隔离、令牌篡改

import { describe, it, expect } from 'vitest';
import type { App } from '@kernel/bootstrap.js';
import type { IdentityService } from '@kernel/contracts/identity.contract.js';
import type { AuthzService } from '@kernel/contracts/authz.contract.js';
import { bootstrap } from '@kernel/bootstrap.js';
import { Tokens } from '@kernel/registry.js';
import { storageModule } from '@modules/storage/index.js';
import { authzModule } from '@modules/authz/index.js';
import { contentModule } from '@modules/content/index.js';
import { httpModule, HttpTokens, type HttpApp } from '@modules/http/index.js';

const TENANT = 'tenant01';
const BOOTSTRAP_TOKEN = 'manage-bootstrap-token';

async function boot(): Promise<{ app: App; api: HttpApp }> {
  const app = await bootstrap({
    modules: [
      storageModule({ dialect: 'sqlite', url: ':memory:' }),
      authzModule({ jwtSecret: 'test-secret' }),
      contentModule([
        {
          slug: 'posts',
          fields: [
            { name: 'title', type: 'text', required: true },
            { name: 'body', type: 'richText' },
            { name: 'internal', type: 'text' },
          ],
        },
      ]),
      httpModule({ tenantId: TENANT, manageToken: BOOTSTRAP_TOKEN }),
    ],
  });
  return { app, api: app.registry.require<HttpApp>(HttpTokens.App) };
}

const json = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ ...json, authorization: `Bearer ${t}` });

/** 引导出管理员并登录，返回令牌对 */
async function bootstrapAndLogin(api: HttpApp): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const b = await api.request('/api/manage/v1/auth/bootstrap', {
    method: 'POST',
    headers: bearer(BOOTSTRAP_TOKEN),
    body: JSON.stringify({ email: 'admin@example.com', password: 'secret-password', name: '管理员' }),
  });
  if (b.status !== 201) throw new Error(`bootstrap failed: ${b.status} ${await b.text()}`);
  const { user } = (await b.json()) as { user: { id: string } };

  const l = await api.request('/api/manage/v1/auth/login', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email: 'admin@example.com', password: 'secret-password' }),
  });
  if (l.status !== 200) throw new Error(`login failed: ${l.status} ${await l.text()}`);
  const pair = (await l.json()) as { accessToken: string; refreshToken: string };
  return { ...pair, userId: user.id };
}

describe('引导与登录', () => {
  it('引导建管理员 → 登录发令牌；错误密码 401（不区分用户不存在）', async () => {
    const { app, api } = await boot();

    // 无引导令牌不能引导
    const noToken = await api.request('/api/manage/v1/auth/bootstrap', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'x@example.com', password: 'x' }),
    });
    expect(noToken.status).toBe(401);

    const { accessToken, refreshToken } = await bootstrapAndLogin(api);
    expect(accessToken.split('.')).toHaveLength(3); // JWT 三段
    expect(refreshToken.length).toBeGreaterThan(20);

    const badPw = await api.request('/api/manage/v1/auth/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'admin@example.com', password: 'wrong-password' }),
    });
    expect(badPw.status).toBe(401);
    expect(((await badPw.json()) as { error: { message: string } }).error.message).toBe('邮箱或密码错误');

    const noUser = await api.request('/api/manage/v1/auth/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }),
    });
    expect(noUser.status).toBe(401);
    expect(((await noUser.json()) as { error: { message: string } }).error.message).toBe('邮箱或密码错误');
    await app.stop();
  });

  it('JWT 可用于写操作；篡改令牌被拒', async () => {
    const { app, api } = await boot();
    const { accessToken } = await bootstrapAndLogin(api);

    const ok = await api.request('/api/manage/v1/posts', {
      method: 'POST',
      headers: bearer(accessToken),
      body: JSON.stringify({ title: 't', body: [] }),
    });
    expect(ok.status).toBe(201);

    const tampered = accessToken.slice(0, -3) + 'aaa';
    const bad = await api.request('/api/manage/v1/posts', {
      method: 'POST',
      headers: bearer(tampered),
      body: JSON.stringify({ title: 'x', body: [] }),
    });
    expect(bad.status).toBe(401);
    await app.stop();
  });
});

describe('RBAC 授权', () => {
  it('编辑角色仅有 posts:update 时：可更新、不可创建、不可删除', async () => {
    const { app, api } = await boot();
    const { accessToken } = await bootstrapAndLogin(api);
    const identity = app.registry.require<IdentityService>(Tokens.Identity);

    await identity.upsertRole({
      tenantId: TENANT,
      slug: 'editor',
      name: '编辑',
      permissions: [{ resource: 'posts', actions: ['update'] }],
    });
    await identity.createUser({
      tenantId: TENANT,
      email: 'editor@example.com',
      name: '编辑',
      password: 'editor-password',
      roles: ['editor'],
    });
    const login = await api.request('/api/manage/v1/auth/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'editor@example.com', password: 'editor-password' }),
    });
    const editor = (await login.json()) as { accessToken: string };

    // 管理员先建一条
    const created = await api.request('/api/manage/v1/posts', {
      method: 'POST',
      headers: bearer(accessToken),
      body: JSON.stringify({ title: 't', body: [] }),
    });
    const entry = (await created.json()) as { id: string };

    const upd = await api.request(`/api/manage/v1/posts/${entry.id}`, {
      method: 'PUT',
      headers: bearer(editor.accessToken),
      body: JSON.stringify({ title: '改了' }),
    });
    expect(upd.status).toBe(200); // 有 update 权限

    const crt = await api.request('/api/manage/v1/posts', {
      method: 'POST',
      headers: bearer(editor.accessToken),
      body: JSON.stringify({ title: 'new', body: [] }),
    });
    expect(crt.status).toBe(403); // 无 create 权限

    const del = await api.request(`/api/manage/v1/posts/${entry.id}`, {
      method: 'DELETE',
      headers: bearer(editor.accessToken),
    });
    expect(del.status).toBe(403); // 无 delete 权限

    const types = await api.request('/api/manage/v1/types', {
      method: 'POST',
      headers: bearer(editor.accessToken),
      body: JSON.stringify({ slug: 'x', fields: [{ name: 'a', type: 'text' }] }),
    });
    expect(types.status).toBe(403); // 无 types 权限
    await app.stop();
  });

  it('scope：deniedFields 在写入时被剥离（字段级拒绝）', async () => {
    const { app, api } = await boot();
    await bootstrapAndLogin(api);
    const identity = app.registry.require<IdentityService>(Tokens.Identity);

    await identity.upsertRole({
      tenantId: TENANT,
      slug: 'limited',
      name: '受限',
      permissions: [{ resource: 'posts', actions: ['create', 'update'], deniedFields: ['internal'] }],
    });
    await identity.createUser({
      tenantId: TENANT,
      email: 'limited@example.com',
      name: '受限',
      password: 'limited-password',
      roles: ['limited'],
    });
    const login = await api.request('/api/manage/v1/auth/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'limited@example.com', password: 'limited-password' }),
    });
    const limited = (await login.json()) as { accessToken: string };

    const created = await api.request('/api/manage/v1/posts', {
      method: 'POST',
      headers: bearer(limited.accessToken),
      body: JSON.stringify({ title: 't', body: [], internal: '机密' }),
    });
    expect(created.status).toBe(201);
    const entity = (await created.json()) as { data: Record<string, unknown> };
    expect(entity.data['internal']).toBeUndefined(); // scope 剥离
    await app.stop();
  });

  it('AuthzService 直接判定：通配资源与通配动作', async () => {
    const { app } = await boot();
    const identity = app.registry.require<IdentityService>(Tokens.Identity);
    const authz = app.registry.require<AuthzService>(Tokens.Authz);
    await identity.upsertRole({
      tenantId: TENANT,
      slug: 'admin',
      name: '管理员',
      permissions: [{ resource: '*', actions: ['*'] }],
      builtin: true,
    });

    const p = { id: 'u1', tenantId: TENANT, kind: 'user', capabilities: ['admin'] };
    expect((await authz.can(p, { resource: 'anything', action: 'delete' })).allowed).toBe(true);

    const noRole = { id: 'u2', tenantId: TENANT, kind: 'user', capabilities: [] };
    const d = await authz.can(noRole, { resource: 'posts', action: 'read' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('E_NO_ROLE');
    await app.stop();
  });
});

describe('刷新令牌轮换与会话撤销', () => {
  it('刷新换发新对；旧 refresh 立即失效（重放触发全量撤销）', async () => {
    const { app, api } = await boot();
    const { refreshToken } = await bootstrapAndLogin(api);

    const r1 = await api.request('/api/manage/v1/auth/refresh', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ refreshToken }),
    });
    expect(r1.status).toBe(200);
    const pair2 = (await r1.json()) as { refreshToken: string };
    expect(pair2.refreshToken).not.toBe(refreshToken);

    // 旧令牌重放 → 401 且撤销该用户全部会话
    const replay = await api.request('/api/manage/v1/auth/refresh', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ refreshToken }),
    });
    expect(replay.status).toBe(401);

    // 新令牌也已被连带撤销（泄漏响应策略）
    const after = await api.request('/api/manage/v1/auth/refresh', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ refreshToken: pair2.refreshToken }),
    });
    expect(after.status).toBe(401);
    await app.stop();
  });

  it('登出后刷新令牌不可用；改密码后旧 refresh 失效', async () => {
    const { app, api } = await boot();
    const { refreshToken, userId } = await bootstrapAndLogin(api);

    await api.request('/api/manage/v1/auth/logout', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ refreshToken }),
    });
    const afterLogout = await api.request('/api/manage/v1/auth/refresh', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ refreshToken }),
    });
    expect(afterLogout.status).toBe(401);

    // 重新登录 → 改密码 → 旧 refresh 失效
    const login = await api.request('/api/manage/v1/auth/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'admin@example.com', password: 'secret-password' }),
    });
    const pair = (await login.json()) as { accessToken: string; refreshToken: string };
    const changed = await api.request(`/api/manage/v1/users/${userId}/password`, {
      method: 'POST',
      headers: bearer(pair.accessToken),
      body: JSON.stringify({ password: 'new-secret-password' }),
    });
    expect(changed.status).toBe(200);
    const staleRefresh = await api.request('/api/manage/v1/auth/refresh', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ refreshToken: pair.refreshToken }),
    });
    expect(staleRefresh.status).toBe(401);
    await app.stop();
  });
});

describe('用户与角色管理', () => {
  it('管理员可列用户/建角色；内置 admin 角色不可删除', async () => {
    const { app, api } = await boot();
    const { accessToken } = await bootstrapAndLogin(api);

    const users = await api.request('/api/manage/v1/users', { headers: bearer(accessToken) });
    expect(((await users.json()) as { items: unknown[] }).items).toHaveLength(1);

    const role = await api.request('/api/manage/v1/roles', {
      method: 'POST',
      headers: bearer(accessToken),
      body: JSON.stringify({ slug: 'viewer', name: '只读', permissions: [{ resource: '*', actions: ['read'] }] }),
    });
    expect(role.status).toBe(201);

    const delBuiltin = await api.request('/api/manage/v1/roles/admin', {
      method: 'DELETE',
      headers: bearer(accessToken),
    });
    expect(delBuiltin.status).toBe(409); // 内置角色不可删

    const delViewer = await api.request('/api/manage/v1/roles/viewer', {
      method: 'DELETE',
      headers: bearer(accessToken),
    });
    expect(delViewer.status).toBe(200);
    await app.stop();
  });

  it('无 authz 角色者访问用户管理 → 403', async () => {
    const { app, api } = await boot();
    await bootstrapAndLogin(api);
    const identity = app.registry.require<IdentityService>(Tokens.Identity);
    await identity.upsertRole({
      tenantId: TENANT,
      slug: 'content-only',
      name: '仅内容',
      permissions: [{ resource: 'posts', actions: ['read'] }],
    });
    await identity.createUser({
      tenantId: TENANT, email: 'c@example.com', name: 'c', password: 'c-password-1', roles: ['content-only'],
    });
    const l = await api.request('/api/manage/v1/auth/login', {
      method: 'POST', headers: json,
      body: JSON.stringify({ email: 'c@example.com', password: 'c-password-1' }),
    });
    const t = (await l.json()) as { accessToken: string };

    const users = await api.request('/api/manage/v1/users', { headers: bearer(t.accessToken) });
    expect(users.status).toBe(403);
    await app.stop();
  });
});
