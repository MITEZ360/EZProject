// scenarios/generic-cms/admin/src/SearchView.tsx
// 全文检索视图：消费服务端 /api/v1/search（中文单字切分 + 预览门）。
// 管理端固定 status=all —— 要能搜到草稿，故必须已登录（否则服务端 403）。
//
// 结果行可"打开"，跳到内容视图并直接弹出该条目的编辑框（由 App 层协调）。

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Empty, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ApiError, apiTypes, searchApi, type EntityTypeDef, type SearchHit } from './lib/api';
import { entryTitle } from './lib/entry-format';

interface Props {
  /** 跳到内容视图并打开指定条目的编辑弹窗 */
  onOpen: (type: string, id: string) => void;
}

export default function SearchView({ onOpen }: Props) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [types, setTypes] = useState<EntityTypeDef[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void apiTypes
      .listTypes()
      .then((r) => setTypes(r.items))
      .catch(() => undefined); // 类型列表拿不到不影响搜索本身
  }, []);

  const run = useCallback(async (): Promise<void> => {
    const text = q.trim();
    if (!text) {
      void message.warning('请输入关键词');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const r = await searchApi.search({ q: text, ...(type ? { type } : {}) });
      setHits(r.items);
      setTotal(r.total);
      setSearched(true);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setLoading(false);
    }
  }, [q, type]);

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          style={{ width: 360 }}
          placeholder="搜索标题、正文…（支持中文子串）"
          enterButton="搜索"
          value={q}
          loading={loading}
          onChange={(e) => setQ(e.target.value)}
          onSearch={() => void run()}
        />
        <Select
          style={{ width: 160 }}
          allowClear
          value={type || undefined}
          placeholder="全部类型"
          options={types.map((t) => ({ value: t.slug, label: t.slug }))}
          onChange={(t) => setType(t ?? '')}
        />
        <Typography.Text type="secondary">
          结果为准实时（索引随内容写入同步更新）
        </Typography.Text>
      </Space>

      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

      {searched && (
        <Typography.Paragraph type="secondary">共 {total} 条命中</Typography.Paragraph>
      )}

      <Table<SearchHit>
        rowKey="id"
        loading={loading}
        dataSource={hits}
        pagination={{ pageSize: 20 }}
        locale={{
          emptyText: searched ? <Empty description="没有命中" /> : <Empty description="输入关键词开始搜索" />,
        }}
        columns={[
          {
            title: '标题',
            render: (_, h) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{entryTitle(h.document)}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {h.document.slug ?? '—'}
                </Typography.Text>
              </Space>
            ),
          },
          { title: '类型', dataIndex: ['document', 'type'], width: 120 },
          {
            title: '状态',
            width: 90,
            render: (_, h) =>
              h.document.status === 'published' ? <Tag color="red">已发布</Tag> : <Tag>草稿</Tag>,
          },
          {
            title: '相关度',
            width: 100,
            // bm25 / ts_rank 的绝对量级都很小（恒 <1），toFixed(3) 会全显示 0.000
            render: (_, h) => h.score.toPrecision(3),
          },
          {
            title: '操作',
            width: 100,
            render: (_, h) => (
              <Button size="small" onClick={() => onOpen(h.document.type, h.id)}>
                打开
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
