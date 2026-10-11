// scenarios/generic-cms/admin/src/ContentView.tsx
// 通用内容管理视图：选类型 → 列表 → 按字段定义动态渲染的编辑表单。
// 不写死任何业务字段——一切由类型定义（决策 #26 调色板）驱动。

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  ApiError,
  api,
  apiTypes,
  type EntryItem,
  type EntityTypeDef,
  type FieldDef,
} from './lib/api';
import { markdownToPt, ptToMarkdown } from '@modules/content/editor/normalize.js';

interface EditState {
  id?: string;
  type: string;
  slug: string;
  status: string;
  values: Record<string, unknown>; // 字段名 → 表单原始值（richText=markdown，json/component=字符串）
}

export default function ContentView() {
  const [types, setTypes] = useState<EntityTypeDef[]>([]);
  const [activeType, setActiveType] = useState<string>('');
  const [items, setItems] = useState<EntryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const refreshTypes = useCallback(async () => {
    const list = (await apiTypes.listTypes()).items;
    setTypes(list);
    setActiveType((cur) => (cur && list.some((t) => t.slug === cur) ? cur : (list[0]?.slug ?? '')));
  }, []);

  const refreshEntries = useCallback(async (type: string) => {
    if (!type) return;
    setLoading(true);
    try {
      setItems((await api.listEntries(type)).items);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTypes();
  }, [refreshTypes]);

  useEffect(() => {
    void refreshEntries(activeType);
  }, [activeType, refreshEntries]);

  const typeDef = types.find((t) => t.slug === activeType);

  const toFormValues = (fields: FieldDef[], data: Record<string, unknown>): Record<string, unknown> => {
    const values: Record<string, unknown> = {};
    for (const f of fields) {
      const v = data[f.name];
      if (v === undefined || v === null) {
        values[f.name] = f.type === 'boolean' ? false : f.type === 'select' && f.multiple ? [] : undefined;
        continue;
      }
      values[f.name] =
        f.type === 'richText'
          ? ptToMarkdown(v)
          : f.type === 'json' || f.type === 'component'
            ? JSON.stringify(v, null, 2)
            : f.type === 'date'
              ? dayjs(v as number)
              : v;
    }
    return values;
  };

  const fromFormValues = (fields: FieldDef[], values: Record<string, unknown>): Record<string, unknown> => {
    const data: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.name];
      if (v === undefined || v === null || v === '') continue;
      data[f.name] =
        f.type === 'richText'
          ? markdownToPt(String(v))
          : f.type === 'json' || f.type === 'component'
            ? JSON.parse(String(v)) // 解析失败由后端校验兜底并提示
            : f.type === 'date'
              ? (v as dayjs.Dayjs).valueOf()
              : v;
    }
    return data;
  };

  const save = async (): Promise<void> => {
    if (!editing || !typeDef) return;
    setSaving(true);
    try {
      const data: Record<string, unknown> = {
        ...fromFormValues(typeDef.fields, editing.values),
        ...(editing.slug ? { slug: editing.slug } : {}),
        status: editing.status,
      };
      if (editing.id) {
        await api.updateEntry(editing.type, editing.id, data);
      } else {
        await api.createEntry(editing.type, data);
      }
      message.success('已保存');
      setEditing(null);
      await refreshEntries(activeType);
    } catch (e) {
      message.error(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await api.deleteEntry(activeType, id);
      message.success('已删除');
      await refreshEntries(activeType);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const renderCell = (f: FieldDef, v: unknown): string => {
    if (v === undefined || v === null) return '—';
    if (f.type === 'richText') {
      const n = ptToMarkdown(v).length;
      return `${n} 字`;
    }
    if (f.type === 'boolean') return v ? '是' : '否';
    if (f.type === 'date') return new Date(v as number).toLocaleString();
    if (f.type === 'json' || f.type === 'component') return JSON.stringify(v).slice(0, 40) + '…';
    if (Array.isArray(v)) return v.join('、');
    return String(v);
  };

  const renderControl = (f: FieldDef, values: Record<string, unknown>): React.ReactNode => {
    const set = (v: unknown): void =>
      setEditing((cur) => (cur ? { ...cur, values: { ...cur.values, [f.name]: v } } : cur));
    const v = values[f.name];
    switch (f.type) {
      case 'text':
        return <Input value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} />;
      case 'longText':
        return <Input.TextArea rows={3} value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} />;
      case 'number':
        return (
          <InputNumber
            style={{ width: '100%' }}
            precision={f.integer ? 0 : undefined}
            min={f.min}
            max={f.max}
            value={(v as number) ?? undefined}
            onChange={(n) => set(n)}
          />
        );
      case 'boolean':
        return <Switch checked={Boolean(v)} onChange={(b) => set(b)} />;
      case 'date':
        return (
          <DatePicker
            style={{ width: '100%' }}
            showTime={!f.dateOnly}
            value={v ? dayjs(v as number) : undefined}
            onChange={(d) => set(d ? d.valueOf() : undefined)}
          />
        );
      case 'select':
        return (
          <Select
            style={{ width: '100%' }}
            mode={f.multiple ? 'multiple' : undefined}
            allowClear
            value={v as string | string[] | undefined}
            options={(f.options ?? []).map((o) => ({ value: o, label: o }))}
            onChange={(x) => set(x)}
          />
        );
      case 'richText':
        return (
          <Input.TextArea
            rows={8}
            value={(v as string) ?? ''}
            onChange={(e) => set(e.target.value)}
            placeholder={'Markdown，保存时归一为 Portable Text\n# 标题\n\n段落\n\n- 列表'}
          />
        );
      case 'relation':
        return <Input value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} placeholder="目标条目 ID" />;
      case 'media':
        return <Input value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} placeholder="资产 ID" />;
      case 'json':
      case 'component':
        return (
          <Input.TextArea
            rows={5}
            value={(v as string) ?? ''}
            onChange={(e) => set(e.target.value)}
            placeholder={f.type === 'json' ? '{"任意": "JSON"}' : '{...}（按字段定义的结构）'}
          />
        );
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select
          style={{ width: 200 }}
          value={activeType || undefined}
          placeholder="选择类型"
          options={types.map((t) => ({ value: t.slug, label: t.slug }))}
          onChange={(t) => setActiveType(t)}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!activeType}
          onClick={() =>
            typeDef &&
            setEditing({
              type: activeType,
              slug: '',
              status: 'draft',
              values: toFormValues(typeDef.fields, {}),
            })
          }
        >
          新建{activeType}
        </Button>
        <Typography.Text type="secondary">内容由类型定义驱动，无写死字段</Typography.Text>
      </Space>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <Table<EntryItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: 'slug', dataIndex: 'slug', width: 160 },
          ...(typeDef?.fields.slice(0, 3).map((f) => ({
            title: f.name,
            render: (_: unknown, it: EntryItem) => renderCell(f, it.data[f.name]),
          })) ?? []),
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (s: string) => (s === 'published' ? <Tag color="red">已发布</Tag> : <Tag>草稿</Tag>),
          },
          {
            title: '更新时间',
            dataIndex: 'updatedAt',
            width: 160,
            render: (n: number) => new Date(n).toLocaleString(),
          },
          {
            title: '操作',
            width: 150,
            render: (_, it) => (
              <Space>
                <Button
                  size="small"
                  onClick={() =>
                    typeDef &&
                    setEditing({
                      id: it.id,
                      type: activeType,
                      slug: it.slug ?? '',
                      status: it.status,
                      values: toFormValues(typeDef.fields, it.data),
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

      <Modal
        title={editing ? `${editing.id ? '编辑' : '新建'} · ${editing.type}` : ''}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void save()}
        confirmLoading={saving}
        width={760}
        okText="保存"
      >
        {editing && typeDef && (
          <div>
            <Space style={{ marginBottom: 16, width: '100%' }} align="baseline">
              <div>
                slug（强唯一，可空）：
                <Input
                  style={{ width: 200, marginLeft: 4 }}
                  value={editing.slug}
                  onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                />
              </div>
              <div>
                状态：
                <Select
                  style={{ width: 120, marginLeft: 4 }}
                  value={editing.status}
                  options={[
                    { value: 'draft', label: '草稿' },
                    { value: 'published', label: '已发布' },
                  ]}
                  onChange={(s) => setEditing({ ...editing, status: s })}
                />
              </div>
            </Space>
            {typeDef.fields.map((f) => (
              <div key={f.name} style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 4 }}>
                  {f.name}
                  {f.required && <span style={{ color: '#c0392b' }}> *</span>}
                  <Typography.Text type="secondary" style={{ marginLeft: 8 }}>{f.type}</Typography.Text>
                </div>
                {renderControl(f, editing.values)}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
