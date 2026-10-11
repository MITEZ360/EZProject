// scenarios/generic-cms/admin/src/App.tsx
// 通用 CMS 管理端壳：登录门 + 视图切换（内容 / 类型管理）。
// 零业务词汇——未来 authz/audit/settings 等通用管理页面在此壳下扩展；
// 具体场景（博客等）复用本壳 + 各自的类型定义种子。

import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Layout, Menu, Space, Typography, message } from 'antd';
import { api, getToken, setToken } from './lib/api';
import ContentView from './ContentView';
import TypesView from './TypesView';

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [view, setView] = useState<'entries' | 'types'>('entries');

  const enter = useCallback(async () => {
    try {
      await api.health();
      setAuthed(true);
    } catch {
      void message.error('无法连接服务，请确认地址与网络');
    }
  }, []);

  // 仅挂载时探测一次（enter 为稳定引用）
  useEffect(() => {
    if (getToken()) void enter();
  }, [enter]);

  if (!authed) {
    return (
      <Layout style={{ minHeight: '100vh' }}>
        <Space direction="vertical" size="middle" style={{ width: 360, margin: '120px auto' }}>
          <Typography.Title level={3}>内容管理后台</Typography.Title>
          <Input.Password
            placeholder="Management Token（MANAGE_TOKEN）"
            defaultValue={getToken()}
            onChange={(e) => setToken(e.target.value)}
          />
          <Button type="primary" block onClick={() => void enter()}>
            进入
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
          ]}
          onClick={({ key }) => setView(key as 'entries' | 'types')}
        />
      </Layout.Sider>
      <Layout.Content style={{ padding: 24 }}>
        {view === 'types' ? <TypesView /> : <ContentView />}
      </Layout.Content>
    </Layout>
  );
}
