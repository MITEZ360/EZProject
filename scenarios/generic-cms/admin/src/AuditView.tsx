// scenarios/generic-cms/admin/src/AuditView.tsx
// 审计日志视图：消费 /api/manage/v1/audit-logs（audit 模块贡献的端点）。
// 模块未加载时端点返回 404 —— 界面明示而非静默空白。

import { useCallback, useEffect, useState } from 'react';
import { Alert, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ApiError, auditApi, type AuditEntry } from './lib/api';

const EVENTS = [
  { value: '', label: '全部事件' },
  { value: 'content.entry.created', label: '创建' },
  { value: 'content.entry.updated', label: '更新' },
  { value: 'content.entry.deleted', label: '删除' },
];

export default function AuditView() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [event, setEvent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async (ev: string) => {
    setLoading(true);
    try {
      setItems((await auditApi.list(ev || undefined)).items);
      setError('');
    } catch (e) {
      // audit 模块未挂载 → 404：明确提示
      const msg =
        e instanceof ApiError && e.status === 404
          ? '审计模块未挂载（服务端未加载 auditModule）'
          : e instanceof Error
            ? e.message
            : String(e);
      setError(msg);
      setItems([]);
      void message.warning(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(event);
  }, [event, refresh]);

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select style={{ width: 200 }} value={event} options={EVENTS} onChange={setEvent} />
        <Typography.Text type="secondary">
          审计日志由 audit 模块订阅领域事件写入（谁在何时改了什么）
        </Typography.Text>
      </Space>
      {error && <Alert type="warning" message={error} style={{ marginBottom: 16 }} />}
      <Table<AuditEntry>
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={{ pageSize: 20 }}
        columns={[
          {
            title: '时间',
            dataIndex: 'occurredAt',
            width: 180,
            render: (n: number) => new Date(n).toLocaleString(),
          },
          {
            title: '事件',
            dataIndex: 'event',
            width: 200,
            render: (e: string) => (
              <Tag color={e.endsWith('created') ? 'green' : e.endsWith('deleted') ? 'red' : 'blue'}>
                {e.replace('content.entry.', '')}
              </Tag>
            ),
          },
          { title: '操作者', dataIndex: 'actorId', width: 140 },
          {
            title: '目标',
            dataIndex: 'detail',
            render: (d: Record<string, unknown>) => `${String(d['type'] ?? '')} / ${String(d['id'] ?? '')}`,
          },
        ]}
      />
    </div>
  );
}
