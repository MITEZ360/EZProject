// scenarios/generic-cms/admin/src/components/RelationPicker.tsx
// 内容引用选择器：把"手输目标条目 UUID"换成"按标题搜索选择"。
//
// 数据来源：类型定义（apiTypes.listTypes）+ 条目列表（api.listEntries）。
// 未限定 targetType 时允许先选类型；已限定则直接搜索该类型。

import { useEffect, useMemo, useState } from 'react';
import { Select, Space, Typography, message } from 'antd';
import { ApiError, api, apiTypes, type EntityTypeDef, type EntryItem } from '../lib/api';
import { entryTitle } from '../lib/entry-format';

interface Props {
  value?: string;
  onChange?: (v: string | undefined) => void;
  /** 限定目标内容类型（relation 字段的 targetType）；未指定则允许切换类型 */
  targetType?: string;
  disabled?: boolean;
}

/** 单次拉取的条目上限（选择器是"就近挑选"，不做远程分页搜索） */
const OPTION_LIMIT = 200;

export default function RelationPicker({ value, onChange, targetType, disabled }: Props) {
  const [types, setTypes] = useState<EntityTypeDef[]>([]);
  const [type, setType] = useState(targetType ?? '');
  const [items, setItems] = useState<EntryItem[]>([]);
  const [loading, setLoading] = useState(false);

  // 限定类型时直接用它；否则拉类型列表让用户挑
  useEffect(() => {
    if (targetType) {
      setType(targetType);
      return;
    }
    let alive = true;
    void apiTypes
      .listTypes()
      .then((r) => {
        if (!alive) return;
        setTypes(r.items);
        setType((cur) => cur || (r.items[0]?.slug ?? ''));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [targetType]);

  useEffect(() => {
    if (!type) return;
    let alive = true;
    setLoading(true);
    void api
      .listEntries(type, OPTION_LIMIT)
      .then((r) => {
        if (alive) setItems(r.items);
      })
      .catch((e) => {
        if (alive) message.error(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [type]);

  const options = useMemo(
    () =>
      items.map((it) => ({
        value: it.id,
        label: it.slug ? `${entryTitle(it)} · ${it.slug}` : entryTitle(it),
      })),
    [items]
  );

  // 已有引用但不在当前拉取窗口内（超出上限 / 已删除）：补一条只读项，避免显示空白
  const missing = Boolean(value) && !options.some((o) => o.value === value);
  const shown = missing
    ? [...options, { value: value as string, label: `${value!.slice(0, 8)}…（不在当前列表）`, disabled: true }]
    : options;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={2}>
      <Space.Compact style={{ width: '100%' }}>
        {!targetType && (
          <Select
            style={{ width: 130 }}
            value={type || undefined}
            placeholder="类型"
            disabled={disabled}
            options={types.map((t) => ({ value: t.slug, label: t.slug }))}
            // 换类型后，原引用必然失效 → 清空
            onChange={(t) => {
              setType(t);
              onChange?.(undefined);
            }}
          />
        )}
        <Select
          style={{ flex: 1 }}
          showSearch
          allowClear
          disabled={disabled}
          loading={loading}
          value={value || undefined}
          placeholder={type ? `搜索 ${type} 的条目…` : '先选择类型'}
          options={shown}
          optionFilterProp="label"
          notFoundContent={loading ? '加载中…' : '无匹配条目'}
          onChange={(v) => onChange?.((v as string | undefined) ?? undefined)}
        />
      </Space.Compact>
      {missing && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          该引用不在当前拉取的前 {OPTION_LIMIT} 条内（可能已被删除）
        </Typography.Text>
      )}
    </Space>
  );
}
