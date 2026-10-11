// scenarios/generic-cms/admin/src/components/FieldControl.tsx
// 字段控件：按 FieldDef 动态渲染 11 种调色板类型。不出现任何业务字段名。
//
// 本轮把三个"占位控件"换成真编辑器：
//   relation  → RelationPicker（按标题搜索目标条目，不再手输 UUID）
//   media     → MediaPicker（媒体库缩略图选择，不再手输资产 ID）
//   component → 递归嵌套表单（repeatable 支持增删 / 上下移）
//
// 值域约定（与 ContentView 的 toFormValues / fromFormValues 对齐）：
//   date → epoch 毫秒；richText → Markdown 文本；json → JSON 文本；
//   component → 结构化对象/数组；其余 → 原始值。
//
// FieldControl ⇄ ComponentField ⇄ FieldRows 互相引用，故同置一文件避免循环 import。

import { Button, Card, DatePicker, Empty, Input, InputNumber, Select, Space, Switch, Tag, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { FieldDef } from '../lib/api';
import { emptyComponentValue } from '../lib/entry-format';
import RelationPicker from './RelationPicker';
import MediaPicker from './MediaPicker';

/** 递归深度保险：类型定义层已限制 component 深 ≤3，这里防脏数据导致栈溢出 */
const MAX_DEPTH = 4;

type ValueMap = Record<string, unknown>;

interface ControlProps {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  depth?: number;
}

/** 单字段控件 */
export default function FieldControl({
  field: f,
  value,
  onChange,
  disabled,
  depth = 0,
}: ControlProps) {
  switch (f.type) {
    case 'text':
      return (
        <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      );
    case 'longText':
      return (
        <Input.TextArea
          rows={3}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
    case 'number':
      return (
        <InputNumber
          style={{ width: '100%' }}
          precision={f.integer ? 0 : undefined}
          min={f.min}
          max={f.max}
          value={(value as number) ?? undefined}
          onChange={(n) => onChange(n)}
          disabled={disabled}
        />
      );
    case 'boolean':
      return <Switch checked={Boolean(value)} onChange={(b) => onChange(b)} disabled={disabled} />;
    case 'date':
      return (
        <DatePicker
          style={{ width: '100%' }}
          showTime={!f.dateOnly}
          value={typeof value === 'number' ? dayjs(value) : undefined}
          onChange={(d) => onChange(d ? d.valueOf() : undefined)}
          disabled={disabled}
        />
      );
    case 'select':
      return (
        <Select
          style={{ width: '100%' }}
          mode={f.multiple ? 'multiple' : undefined}
          allowClear
          disabled={disabled}
          value={value as string | string[] | undefined}
          options={(f.options ?? []).map((o) => ({ value: o, label: o }))}
          onChange={(x) => onChange(x)}
        />
      );
    case 'richText':
      return (
        <Input.TextArea
          rows={8}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={'Markdown，保存时归一为 Portable Text\n# 标题\n\n段落\n\n- 列表'}
        />
      );
    case 'relation':
      return (
        <RelationPicker
          value={value as string | undefined}
          onChange={(v) => onChange(v)}
          targetType={f.targetType}
          disabled={disabled}
        />
      );
    case 'media':
      return <MediaPicker value={value as string | undefined} onChange={(v) => onChange(v)} disabled={disabled} />;
    case 'component':
      return <ComponentField field={f} value={value} onChange={onChange} disabled={disabled} depth={depth} />;
    case 'json':
      return (
        <Input.TextArea
          rows={5}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder='{"任意": "JSON"}'
        />
      );
  }
}

/** 一组字段（label + 控件）。ContentView 与嵌套结构共用 */
export function FieldRows({
  fields,
  value,
  onChange,
  disabled,
  depth = 0,
}: {
  fields: FieldDef[];
  value: ValueMap;
  onChange: (name: string, v: unknown) => void;
  disabled?: boolean;
  depth?: number;
}) {
  return (
    <>
      {fields.map((f) => (
        <div key={f.name} style={{ marginBottom: depth > 0 ? 12 : 16 }}>
          <div style={{ marginBottom: 4 }}>
            {f.name}
            {f.required && <span style={{ color: '#c0392b' }}> *</span>}
            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              {f.type}
            </Typography.Text>
          </div>
          <FieldControl
            field={f}
            value={value[f.name]}
            onChange={(v) => onChange(f.name, v)}
            disabled={disabled}
            depth={depth}
          />
        </div>
      ))}
    </>
  );
}

/** 嵌套结构（component）：repeatable 渲染为可增删排序的卡片列表 */
function ComponentField({ field, value, onChange, disabled, depth = 0 }: ControlProps) {
  const subFields = field.fields ?? [];

  if (!subFields.length) {
    return <Typography.Text type="danger">该嵌套结构未定义子字段</Typography.Text>;
  }
  if (depth >= MAX_DEPTH) {
    return <Typography.Text type="warning">嵌套层级过深（上限 {MAX_DEPTH} 层），已停止渲染</Typography.Text>;
  }

  // —— 单实例 ——
  if (!field.repeatable) {
    const item = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as ValueMap;
    return (
      <Card size="small" style={{ background: '#fafafa' }}>
        <FieldRows
          fields={subFields}
          value={item}
          onChange={(name, v) => onChange({ ...item, [name]: v })}
          disabled={disabled}
          depth={depth + 1}
        />
      </Card>
    );
  }

  // —— 可重复 ——
  const items = Array.isArray(value) ? (value as ValueMap[]) : [];

  const setItemField = (i: number, name: string, v: unknown): void =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, [name]: v } : it)));

  const removeItem = (i: number): void => onChange(items.filter((_, idx) => idx !== i));

  const moveItem = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) return;
    const next = [...items];
    next[i] = b;
    next[j] = a;
    onChange(next);
  };

  return (
    <div>
      {items.length === 0 && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无条目" style={{ margin: '8px 0' }} />
      )}
      {items.map((item, i) => (
        <Card
          key={i}
          size="small"
          style={{ background: '#fafafa', marginBottom: 8 }}
          title={<Tag>#{i + 1}</Tag>}
          extra={
            <Space size={4}>
              <Button
                size="small"
                type="text"
                icon={<ArrowUpOutlined />}
                disabled={disabled || i === 0}
                onClick={() => moveItem(i, -1)}
              />
              <Button
                size="small"
                type="text"
                icon={<ArrowDownOutlined />}
                disabled={disabled || i === items.length - 1}
                onClick={() => moveItem(i, 1)}
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                disabled={disabled}
                onClick={() => removeItem(i)}
              />
            </Space>
          }
        >
          <FieldRows
            fields={subFields}
            value={item}
            onChange={(name, v) => setItemField(i, name, v)}
            disabled={disabled}
            depth={depth + 1}
          />
        </Card>
      ))}
      <Button
        icon={<PlusOutlined />}
        disabled={disabled}
        onClick={() => onChange([...items, emptyComponentValue(field)])}
      >
        添加{field.name}
      </Button>
    </div>
  );
}
