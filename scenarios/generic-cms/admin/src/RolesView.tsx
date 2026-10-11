// 角色管理视图：权限点编辑（资源 × 动作 × 字段级 scope）。
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { ApiError, rolesApi, type AuthzPermission, type RoleItem } from './lib/api';

const ACTIONS = ['read', 'create', 'update', 'delete'];
let seq = 0;
const newPerm = (): AuthzPermission & { key: string } => ({
  key: `p${Date.now().toString(36)}${seq++}`,
  resource: '*',
  actions: [],
  deniedFields: [],
});

export default function RolesView() {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ slug: string; name: string; perms: Array<AuthzPermission & { key: string }> } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRoles((await rolesApi.list()).items);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? '当前账号无角色管理权限（authz:read/update）' : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (): Promise<void> => {
    if (!editing) return;
    setBusy(true);
    try {
      await rolesApi.upsert({
        slug: editing.slug.trim(),
        name: editing.name.trim() || editing.slug,
        permissions: editing.perms.map((p) => ({
          resource: p.resource,
          actions: p.actions,
          deniedFields: (p.deniedFields ?? []).filter(Boolean),
        })),
      });
      message.success('角色已保存');
      setEditing(null);
      await refresh();
    } catch (e) {
      message.error(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (slug: string): Promise<void> => {
    try {
      await rolesApi.remove(slug);
      message.success('已删除');
      await refresh();
    } catch (e) {
      message.error(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ slug: '', name: '', perms: [newPerm()] })}>
          新建角色
        </Button>
        <Typography.Text type="secondary">
          资源写 * 或类型 slug；动作写 * 或具体动作；字段拒绝用于 scope（如 internal）
        </Typography.Text>
      </Space>
      {error && <Alert type="warning" message={error} style={{ marginBottom: 16 }} />}
      <Table<RoleItem>
        rowKey="slug"
        loading={loading}
        dataSource={roles}
        pagination={false}
        columns={[
          { title: 'slug', dataIndex: 'slug', width: 160 },
          { title: '名称', dataIndex: 'name', width: 160 },
          {
            title: '权限',
            dataIndex: 'permissions',
            render: (ps: AuthzPermission[]) =>
              ps.map((p, i) => (
                <Tag key={i} color={p.resource === '*' && p.actions.includes('*') ? 'red' : 'blue'}>
                  {p.resource} · {p.actions.join('/')}
                  {p.deniedFields?.length ? ` (−${p.deniedFields.join(',')})` : ''}
                </Tag>
              )),
          },
          {
            title: '操作',
            width: 150,
            render: (_, r) => (
              <Space>
                <Button
                  size="small"
                  disabled={Boolean(r.builtin)}
                  onClick={() =>
                    setEditing({
                      slug: r.slug,
                      name: r.name,
                      perms: r.permissions.length ? r.permissions.map((p) => ({ ...p, key: `p${Date.now().toString(36)}${seq++}` })) : [newPerm()],
                    })
                  }
                >
                  编辑
                </Button>
                <Button size="small" danger disabled={Boolean(r.builtin)} onClick={() => void remove(r.slug)}>
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal title={editing?.slug ? `编辑角色：${editing.slug}` : '新建角色'} open={editing !== null} onCancel={() => setEditing(null)} onOk={() => void save()} confirmLoading={busy} width={760} okText="保存">
        {editing && (
          <div>
            <Space style={{ marginBottom: 12 }}>
              <Input placeholder="slug" value={editing.slug} disabled={roles.some((r) => r.slug === editing.slug)} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} style={{ width: 200 }} />
              <Input placeholder="名称" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} style={{ width: 200 }} />
            </Space>
            {editing.perms.map((p, idx) => (
              <Space key={p.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                <Input
                  placeholder="资源（* 或类型 slug）"
                  style={{ width: 170 }}
                  value={p.resource}
                  onChange={(e) => {
                    const perms = [...editing.perms];
                    perms[idx] = { ...p, resource: e.target.value };
                    setEditing({ ...editing, perms });
                  }}
                />
                <Select
                  mode="multiple"
                  placeholder="动作"
                  style={{ width: 220 }}
                  value={p.actions}
                  options={['*', ...ACTIONS].map((a) => ({ value: a, label: a }))}
                  onChange={(v) => {
                    const perms = [...editing.perms];
                    perms[idx] = { ...p, actions: v };
                    setEditing({ ...editing, perms });
                  }}
                />
                <Input
                  placeholder="字段拒绝（逗号分隔，scope）"
                  style={{ width: 240 }}
                  value={(p.deniedFields ?? []).join(',')}
                  onChange={(e) => {
                    const perms = [...editing.perms];
                    perms[idx] = { ...p, deniedFields: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) };
                    setEditing({ ...editing, perms });
                  }}
                />
                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setEditing({ ...editing, perms: editing.perms.filter((_, i) => i !== idx) })} />
              </Space>
            ))}
            <Button type="dashed" block icon={<PlusOutlined />} onClick={() => setEditing({ ...editing, perms: [...editing.perms, newPerm()] })}>
              添加权限项
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
