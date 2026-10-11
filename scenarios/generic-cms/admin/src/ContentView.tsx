// scenarios/generic-cms/admin/src/ContentView.tsx
// 通用内容管理视图：选类型 → 列表 → 按字段定义动态渲染的编辑表单。
// 不写死任何业务字段——一切由类型定义（决策 #26 调色板）驱动。
//
// 本文件只负责"列表 + 表单骨架 + 值形态转换"；
// 单字段控件（含 relation 选择器 / media 媒体库 / component 递归嵌套）见 components/FieldControl。

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ApiError, api, apiTypes, type EntryItem, type EntityTypeDef, type FieldDef } from './lib/api';
import { emptyFieldValue, emptyFormValues, normalizeComponentValue } from './lib/entry-format';
import { FieldRows } from './components/FieldControl';
import { markdownToPt, ptToMarkdown } from '@modules/content/editor/normalize.js';

interface EditState {
  id?: string;
  type: string;
  slug: string;
  status: string;
  /** 字段名 → 表单值（richText=Markdown 文本，json=JSON 文本，component=结构化对象/数组） */
  values: Record<string, unknown>;
}

interface Props {
  /** 从搜索视图跳转过来时要求直接打开的条目 */
  pendingEdit?: { type: string; id: string } | null;
  /** 消费完成后通知外壳清空（避免重复打开） */
  onConsumePending?: () => void;
}

/**
 * 实体值 → 表单值（只做形态转换，控件层不再做类型判断）。
 * 放在组件外：纯函数无闭包依赖，也就不会成为 effect 的依赖抖动源。
 */
function toFormValues(fields: FieldDef[], data: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    const v = data[f.name];
    if (v === undefined || v === null) {
      values[f.name] = emptyFieldValue(f);
      continue;
    }
    values[f.name] =
      f.type === 'richText'
        ? ptToMarkdown(v)
        : f.type === 'json'
          ? JSON.stringify(v, null, 2)
          : f.type === 'component'
            ? normalizeComponentValue(f, v) // 结构化编辑（不再是 JSON 文本）
            : v;
  }
  return values;
}

/** 表单值 → 实体值（component 已是结构，直接提交） */
function fromFormValues(fields: FieldDef[], values: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (v === undefined || v === null || v === '') continue;
    // 空数组 / 空对象仍提交（表示显式清空）
    data[f.name] =
      f.type === 'richText'
        ? markdownToPt(String(v))
        : f.type === 'json'
          ? JSON.parse(String(v)) // 解析失败由后端校验兜底并提示
          : v;
  }
  return data;
}

export default function ContentView({ pendingEdit, onConsumePending }: Props = {}) {
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

  // 从搜索跳转：切到目标类型 → 找到该条目 → 直接打开编辑框
  useEffect(() => {
    if (!pendingEdit || types.length === 0) return;
    const td = types.find((t) => t.slug === pendingEdit.type);
    if (!td) {
      void message.error(`类型 ${pendingEdit.type} 不存在`);
      onConsumePending?.();
      return;
    }
    let alive = true;
    setActiveType(pendingEdit.type);
    void api
      .listEntries(pendingEdit.type)
      .then((page) => {
        if (!alive) return;
        const it = page.items.find((x) => x.id === pendingEdit.id);
        if (!it) {
          void message.warning('未找到该条目（可能已被删除）');
          return;
        }
        setEditing({
          id: it.id,
          type: it.type,
          slug: it.slug ?? '',
          status: it.status,
          values: toFormValues(td.fields, it.data),
        });
      })
      .catch((e) => {
        if (alive) void message.error(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) onConsumePending?.();
      });
    return () => {
      alive = false;
    };
  }, [pendingEdit, types, onConsumePending]);

  const typeDef = types.find((t) => t.slug === activeType);


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

  /** 列表单元格：引用类字段只存 ID，列表不做二次解析（避免 N 次查询） */
  const renderCell = (f: FieldDef, v: unknown): string => {
    if (v === undefined || v === null || v === '') return '—';
    switch (f.type) {
      case 'richText':
        return `${ptToMarkdown(v).length} 字`;
      case 'boolean':
        return v ? '是' : '否';
      case 'date':
        return new Date(v as number).toLocaleString();
      case 'relation':
      case 'media':
        return `${String(v).slice(0, 8)}…`;
      case 'component':
        return Array.isArray(v) ? `${v.length} 项` : '1 项';
      case 'json':
        return JSON.stringify(v).slice(0, 40) + '…';
      default:
        return Array.isArray(v) ? v.join('、') : String(v);
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
              values: emptyFormValues(typeDef.fields),
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
                <Popconfirm
                  title="确认删除该条目？"
                  description="删除后不可在界面上撤销（可用版本历史回滚）"
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() => void remove(it.id)}
                >
                  {/* 删除是不可逆操作，必须二次确认：列表里"删除"和"编辑"
                      挨得极近，手滑点到的概率不低 */}
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
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
        width={820}
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
            <FieldRows
              fields={typeDef.fields}
              value={editing.values}
              onChange={(name, v) =>
                setEditing((cur) => (cur ? { ...cur, values: { ...cur.values, [name]: v } } : cur))
              }
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
