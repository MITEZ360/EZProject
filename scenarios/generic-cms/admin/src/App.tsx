// scenarios/generic-cms/admin/src/App.tsx
// 通用 CMS 管理端壳：登录门 + 视图切换（内容 / 类型管理）。
// 零业务词汇——未来 authz/audit/settings 等通用管理页面在此壳下扩展；
// 具体场景（博客等）复用本壳 + 各自的类型定义种子。

import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Layout, Menu, Space, Typography, message } from 'antd';
import { api, authApi, getToken, hasSession, setToken } from './lib/api';
import ContentView from './ContentView';
import TypesView from './TypesView';
import AuditView from './AuditView';
import UsersView from './UsersView';
import RolesView from './RolesView';
import SettingsView from './SettingsView';

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [view, setView] = useState<'entries' | 'types' | 'audit' | 'settings' | 'users' | 'roles'>('entries');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const probe = useCallback(async () => {
    try {
      await api.health();
      if (hasSession()) await authApi.me(); // 令牌有效才进入
      setAuthed(true);
    } catch {
      /* 令牌失效：停留在登录页 */
    }
  }, []);

  // 仅挂载时探测一次（已有会话则免登录）
  useEffect(() => {
    void probe();
  }, [probe]);

  const login = useCallback(async () => {
    setBusy(true);
    try {
      await authApi.login(email, password);
      setAuthed(true);
      void message.success('登录成功');
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '登录失败');
    } finally {
      setBusy(false);
    }
  }, [email, password]);

  if (!authed) {
    return (
      <Layout style={{ minHeight: '100vh' }}>
        <Space direction="vertical" size="middle" style={{ width: 360, margin: '120px auto' }}>
          <Typography.Title level={3}>内容管理后台</Typography.Title>
          <Input
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onPressEnter={() => void login()}
          />
          <Input.Password
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onPressEnter={() => void login()}
          />
          <Button type="primary" block loading={busy} onClick={() => void login()}>
            登录
          </Button>
          <Typography.Text type="secondary">
            首次部署：先用引导令牌调用 /api/manage/v1/auth/bootstrap 创建管理员
          </Typography.Text>
          <Input.Password
            placeholder="引导令牌（MANAGE_TOKEN，仅调试用）"
            defaultValue={getToken()}
            onChange={(e) => setToken(e.target.value)}
          />
          <Button block onClick={() => void probe().then(() => setAuthed(true))}>
            以引导令牌进入
          </Button>
        </Space>
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[view]}
          items={[
            { key: 'entries', label: '内容' },
            { key: 'types', label: '类型管理' },
            { key: 'audit', label: '审计日志' },
            { key: 'users', label: '用户管理' },
            { key: 'roles', label: '角色权限' },
            { key: 'settings', label: '系统设置' },
          ]}
          onClick={({ key }) => setView(key as typeof view)}
        />
      </Layout.Sider>
      <Layout.Content style={{ padding: 24 }}>
        {view === 'types' && <TypesView />}
        {view === 'audit' && <AuditView />}
        {view === 'users' && <UsersView />}
        {view === 'roles' && <RolesView />}
        {view === 'settings' && <SettingsView />}
        {view === 'entries' && <ContentView />}
      </Layout.Content>
    </Layout>
  );
}
