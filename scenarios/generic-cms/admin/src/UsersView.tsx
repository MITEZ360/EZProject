// 用户管理视图：列表 / 新建 / 改角色 / 重置密码（服务端 RBAC 生效）。
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ApiError, usersApi, rolesApi, type RoleItem, type UserItem } from './lib/api';

export default function UsersView() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState<{ email: string; name: string; password: string; roles: string[] } | null>(null);
  const [resetting, setResetting] = useState<{ id: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([usersApi.list(), rolesApi.list()]);
      setUsers(u.items);
      setRoles(r.items);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? '当前账号无用户管理权限（authz:update）' : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submitCreate = async (): Promise<void> => {
    if (!creating) return;
    setBusy(true);
    try {
      await usersApi.create(creating);
      message.success('已创建');
      setCreating(null);
      await refresh();
    } catch (e) {
      message.error(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeRoles = async (id: string, next: string[]): Promise<void> => {
    try {
      await usersApi.update(id, { roles: next });
      message.success('已更新角色');
      await refresh();
    } catch (e) {
      message.error(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    }
  };

  const toggleStatus = async (u: UserItem): Promise<void> => {
    try {
      await usersApi.update(u.id, { status: u.status === 'active' ? 'disabled' : 'active' });
      message.success(u.status === 'active' ? '已禁用（会话已撤销）' : '已启用');
      await refresh();
    } catch (e) {
      message.error(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    }
  };

  const submitReset = async (): Promise<void> => {
    if (!resetting) return;
    setBusy(true);
    try {
      await usersApi.setPassword(resetting.id, resetting.password);
      message.success('密码已重置（旧会话已撤销）');
      setResetting(null);
    } catch (e) {
      message.error(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating({ email: '', name: '', password: '', roles: [] })}>
          新建用户
        </Button>
        <Typography.Text type="secondary">角色决定权限（RBAC）；禁用/改密会撤销该用户全部会话</Typography.Text>
      </Space>
      {error && <Alert type="warning" message={error} style={{ marginBottom: 16 }} />}
      <Table<UserItem>
        rowKey="id"
        loading={loading}
        dataSource={users}
        pagination={false}
        columns={[
          { title: '邮箱', dataIndex: 'email' },
          { title: '姓名', dataIndex: 'name', width: 140 },
          {
            title: '角色',
            dataIndex: 'roles',
            render: (rs: string[], u) => (
              <Select
                mode="multiple"
                size="small"
                style={{ minWidth: 200 }}
                value={rs}
                options={roles.map((r) => ({ value: r.slug, label: r.name }))}
                onChange={(v) => void changeRoles(u.id, v)}
              />
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (s: string) => (s === 'active' ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>),
          },
          {
            title: '操作',
            width: 160,
            render: (_, u) => (
              <Space>
                <Button size="small" onClick={() => setResetting({ id: u.id, password: '' })}>
                  重置密码
                </Button>
                <Button size="small" danger onClick={() => void toggleStatus(u)}>
                  {u.status === 'active' ? '禁用' : '启用'}
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal title="新建用户" open={creating !== null} onCancel={() => setCreating(null)} onOk={() => void submitCreate()} confirmLoading={busy} okText="创建">
        {creating && (
          <Form layout="vertical">
            <Form.Item label="邮箱" required>
              <Input value={creating.email} onChange={(e) => setCreating({ ...creating, email: e.target.value })} />
            </Form.Item>
            <Form.Item label="姓名">
              <Input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
            </Form.Item>
            <Form.Item label="密码（至少 8 位）" required>
              <Input.Password value={creating.password} onChange={(e) => setCreating({ ...creating, password: e.target.value })} />
            </Form.Item>
            <Form.Item label="角色">
              <Select
                mode="multiple"
                value={creating.roles}
                options={roles.map((r) => ({ value: r.slug, label: r.name }))}
                onChange={(v) => setCreating({ ...creating, roles: v })}
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal title="重置密码" open={resetting !== null} onCancel={() => setResetting(null)} onOk={() => void submitReset()} confirmLoading={busy}>
        {resetting && (
          <Input.Password placeholder="新密码（至少 8 位）" value={resetting.password} onChange={(e) => setResetting({ ...resetting, password: e.target.value })} />
        )}
      </Modal>
    </div>
  );
}
