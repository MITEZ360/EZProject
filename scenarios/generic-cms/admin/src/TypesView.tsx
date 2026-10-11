// scenarios/blog/admin/src/TypesView.tsx
// 类型管理视图：类型列表 + 定义表单（字段动态增删，调色板下拉）。
// 提交到 POST /api/manage/v1/types（逻辑 Schema：更新定义不迁移旧数据，界面明示）。

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  ApiError,
  apiTypes,
  FIELD_TYPE_LABELS,
  type EntityTypeDef,
  type FieldDef,
} from './lib/api';

const FIELD_TYPES = Object.keys(FIELD_TYPE_LABELS) as FieldDef['type'][];

interface FieldRow {
  key: string;
  name: string;
  type: FieldDef['type'];
  required: boolean;
  optionsText: string; // select 专用：逗号分隔
}

let rowSeq = 0;
const newRow = (): FieldRow => ({
  key: `r${Date.now().toString(36)}${rowSeq++}`,
  name: '',
  type: 'text',
  required: false,
  optionsText: '',
});

export default function TypesView() {
  const [items, setItems] = useState<EntityTypeDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{
    slug: string;
    fields: FieldRow[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await apiTypes.listTypes()).items);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toRows = (def: EntityTypeDef): FieldRow[] =>
    def.fields.map((f) => ({
      key: `r${Date.now().toString(36)}${rowSeq++}`,
      name: f.name,
      type: f.type,
      required: f.required ?? false,
      optionsText: (f.options ?? []).join(','),
    }));

  const save = async (): Promise<void> => {
    if (!editing) return;
    setSaving(true);
    try {
      const fields: FieldDef[] = editing.fields.map((r) => ({
        name: r.name.trim(),
        type: r.type,
        ...(r.required ? { required: true } : {}),
        ...(r.type === 'select'
          ? { options: r.optionsText.split(',').map((s) => s.trim()).filter(Boolean) }
          : {}),
      }));
      await apiTypes.defineType({ slug: editing.slug.trim(), fields });
      message.success('类型已保存（更新定义不迁移旧数据）');
      setEditing(null);
      await refresh();
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      message.error(msg);
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
          onClick={() => setEditing({ slug: '', fields: [newRow()] })}
        >
          新建类型
        </Button>
        <Typography.Text type="secondary">
          类型定义是数据：保存即生效（逻辑 Schema，无 DDL）
        </Typography.Text>
      </Space>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <Table<EntityTypeDef>
        rowKey="slug"
        loading={loading}
        dataSource={items}
        pagination={false}
        columns={[
          { title: '类型 slug', dataIndex: 'slug' },
          {
            title: '字段',
            dataIndex: 'fields',
            render: (fields: FieldDef[]) =>
              fields.map((f, i) => (
                <Tag key={i}>
                  {f.name} · {FIELD_TYPE_LABELS[f.type]}
                  {f.required ? ' *' : ''}
                </Tag>
              )),
          },
          {
            title: '操作',
            render: (_, def) => (
              <Button size="small" onClick={() => setEditing({ slug: def.slug, fields: toRows(def) })}>
                编辑
              </Button>
            ),
          },
        ]}
      />

      <Modal
        title={editing && items.some((i) => i.slug === editing.slug) ? `编辑类型：${editing.slug}` : '新建类型'}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void save()}
        confirmLoading={saving}
        width={760}
        okText="保存类型"
      >
        {editing && (
          <Form layout="vertical">
            <Form.Item label="类型 slug（小写 kebab-case，保存后建议不改）" required>
              <Input
                value={editing.slug}
                disabled={items.some((i) => i.slug === editing.slug)}
                onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                placeholder="如：products"
              />
            </Form.Item>

            {editing.fields.map((row, idx) => (
              <Space key={row.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                <Input
                  placeholder="字段名"
                  style={{ width: 160 }}
                  value={row.name}
                  onChange={(e) => {
                    const fields = [...editing.fields];
                    fields[idx] = { ...row, name: e.target.value };
                    setEditing({ ...editing, fields });
                  }}
                />
                <Select
                  style={{ width: 130 }}
                  value={row.type}
                  options={FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPE_LABELS[t] }))}
                  onChange={(t) => {
                    const fields = [...editing.fields];
                    fields[idx] = { ...row, type: t };
                    setEditing({ ...editing, fields });
                  }}
                />
                {row.type === 'select' && (
                  <Input
                    placeholder="选项（逗号分隔）"
                    style={{ width: 200 }}
                    value={row.optionsText}
                    onChange={(e) => {
                      const fields = [...editing.fields];
                      fields[idx] = { ...row, optionsText: e.target.value };
                      setEditing({ ...editing, fields });
                    }}
                  />
                )}
                <span>
                  必填{' '}
                  <Switch
                    size="small"
                    checked={row.required}
                    onChange={(v) => {
                      const fields = [...editing.fields];
                      fields[idx] = { ...row, required: v };
                      setEditing({ ...editing, fields });
                    }}
                  />
                </span>
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setEditing({ ...editing, fields: editing.fields.filter((_, i) => i !== idx) })
                  }
                />
              </Space>
            ))}
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={() => setEditing({ ...editing, fields: [...editing.fields, newRow()] })}
            >
              添加字段
            </Button>
          </Form>
        )}
      </Modal>
    </div>
  );
}
