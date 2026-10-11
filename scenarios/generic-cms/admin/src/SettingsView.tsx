// scenarios/generic-cms/admin/src/SettingsView.tsx
// 系统设置视图：per-tenant KV（消费 /api/manage/v1/settings）。
// 值为任意 JSON：界面用 JSON 文本编辑，保存时解析。

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Space, Table, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ApiError, settingsApi, type SettingItem } from './lib/api';

export default function SettingsView() {
  const [items, setItems] = useState<SettingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ key: string; text: string; isNew: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await settingsApi.list()).items);
      setError('');
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 404
          ? '设置模块未挂载（服务端未加载 settingsModule）'
          : e instanceof Error
            ? e.message
            : String(e);
      setError(msg);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (): Promise<void> => {
    if (!editing) return;
    setSaving(true);
    try {
      let value: unknown;
      try {
        value = JSON.parse(editing.text);
      } catch {
        value = editing.text; // 非 JSON 文本按字符串存
      }
      await settingsApi.set(editing.key.trim(), value);
      message.success('已保存');
      setEditing(null);
      await refresh();
    } catch (e) {
      message.error(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setEditing({ key: '', text: '', isNew: true })}
        >
          新增设置
        </Button>
        <Typography.Text type="secondary">
          键值设置（值任意 JSON），按租户隔离
        </Typography.Text>
      </Space>
      {error && <Alert type="warning" message={error} style={{ marginBottom: 16 }} />}
      <Table<SettingItem>
        rowKey="key"
        loading={loading}
        dataSource={items}
        pagination={false}
        columns={[
          { title: '键', dataIndex: 'key', width: 220 },
          {
            title: '值',
            dataIndex: 'value',
            render: (v: unknown) => <code>{JSON.stringify(v)}</code>,
          },
          {
            title: '更新时间',
            dataIndex: 'updatedAt',
            width: 180,
            render: (n: number) => new Date(n).toLocaleString(),
          },
          {
            title: '操作',
            width: 90,
            render: (_, it) => (
              <Button
                size="small"
                onClick={() =>
                  setEditing({ key: it.key, text: JSON.stringify(it.value, null, 2), isNew: false })
                }
              >
                编辑
              </Button>
            ),
          },
        ]}
      />

      <Modal
        title={editing?.isNew ? '新增设置' : `编辑设置：${editing?.key ?? ''}`}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void save()}
        confirmLoading={saving}
        okText="保存"
      >
        {editing && (
          <div>
            <div style={{ marginBottom: 12 }}>
              键：
              <Input
                style={{ width: 260, marginLeft: 4 }}
                disabled={!editing.isNew}
                placeholder="site.title"
                value={editing.key}
                onChange={(e) => setEditing({ ...editing, key: e.target.value })}
              />
            </div>
            <div>
              值（JSON 或纯文本）：
              <Input.TextArea
                rows={5}
                style={{ marginTop: 4 }}
                value={editing.text}
                onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                placeholder={'"我的站点" 或 {"a":1} 或 纯文本'}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
