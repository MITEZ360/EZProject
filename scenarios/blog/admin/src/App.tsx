// scenarios/blog/admin/src/App.tsx
// 博客后台（阶段一）：Token 登录门 + 文章列表 + 编辑（Markdown 归一为 Portable Text）。
// 不引入路由库：状态切换视图，保持最小依赖。

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { ApiError, api, getToken, setToken, type PostListItem } from './lib/api';
import { markdownToPt, ptToMarkdown } from './lib/pt';

interface EditState {
  id?: string;
  title: string;
  slug: string;
  status: string;
  markdown: string;
}

const EMPTY: EditState = { title: '', slug: '', status: 'draft', markdown: '' };

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [items, setItems] = useState<PostListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api.listPosts();
      setItems(page.items);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) void refresh();
  }, [authed, refresh]);

  const save = async (): Promise<void> => {
    if (!editing) return;
    setSaving(true);
    try {
      const data: Record<string, unknown> = {
        title: editing.title,
        slug: editing.slug,
        status: editing.status,
        body: markdownToPt(editing.markdown), // 铁律：入库必须是 PT 结构
      };
      if (editing.id) {
        await api.updatePost(editing.id, data);
      } else {
        await api.createPost(data);
      }
      message.success('已保存');
      setEditing(null);
      await refresh();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.code}: ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await api.deletePost(id);
      message.success('已删除');
      await refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  if (!authed) {
    return (
      <Layout style={{ minHeight: '100vh', placeItems: 'center' }}>
        <Space direction="vertical" size="middle" style={{ width: 360, margin: '120px auto' }}>
          <Typography.Title level={3}>博客后台</Typography.Title>
          <Input.Password
            placeholder="Management Token（MANAGE_TOKEN）"
            defaultValue={getToken()}
            onChange={(e) => setToken(e.target.value)}
          />
          <Button
            type="primary"
            block
            onClick={async () => {
              try {
                await api.health();
                setAuthed(true);
              } catch {
                void message.error('无法连接服务，请确认地址与网络');
              }
            }}
          >
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
          selectable={false}
          items={[{ key: 'new', label: '新建文章' }]}
          onClick={() => setEditing({ ...EMPTY })}
        />
      </Layout.Sider>
      <Layout.Content style={{ padding: 24 }}>
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
        <Table<PostListItem>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={false}
          columns={[
            { title: '标题', dataIndex: ['data', 'title'] },
            { title: 'slug', dataIndex: 'slug' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (s: string) =>
                s === 'published' ? <Tag color="red">已发布</Tag> : <Tag>草稿</Tag>,
            },
            {
              title: '更新时间',
              dataIndex: 'updatedAt',
              render: (n: number) => new Date(n).toLocaleString(),
            },
            {
              title: '操作',
              render: (_, it) => (
                <Space>
                  <Button
                    size="small"
                    onClick={() =>
                      setEditing({
                        id: it.id,
                        title: it.data['title'] ?? '',
                        slug: it.slug ?? '',
                        status: it.status,
                        markdown: ptToMarkdown(it.data['body']),
                      })
                    }
                  >
                    编辑
                  </Button>
                  <Button size="small" danger onClick={() => void remove(it.id)}>
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Layout.Content>

      <Modal
        title={editing?.id ? '编辑文章' : '新建文章'}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void save()}
        confirmLoading={saving}
        width={720}
      >
        {editing && (
          <Form layout="vertical">
            <Form.Item label="标题" required>
              <Input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              />
            </Form.Item>
            <Form.Item label="slug" required>
              <Input
                value={editing.slug}
                onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
              />
            </Form.Item>
            <Form.Item label="状态">
              <Select
                value={editing.status}
                onChange={(v) => setEditing({ ...editing, status: v })}
                options={[
                  { value: 'draft', label: '草稿' },
                  { value: 'published', label: '已发布' },
                ]}
              />
            </Form.Item>
            <Form.Item label="正文（Markdown，保存时归一为 Portable Text）">
              <Input.TextArea
                rows={12}
                value={editing.markdown}
                onChange={(e) => setEditing({ ...editing, markdown: e.target.value })}
                placeholder={'# 标题\n\n段落文本\n\n- 列表项'}
              />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </Layout>
  );
}
