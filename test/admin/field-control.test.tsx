// test/admin/field-control.test.tsx
// FieldControl：11 种调色板类型的动态渲染 + component 递归嵌套表单。
//
// 重点覆盖"占位控件换真编辑器"那一轮改动的行为：repeatable 的增删排序、
// 单实例合并语义、深度熔断——这些逻辑纯 typecheck 看不出来，
// 而一旦错了就是内容静默写坏。

import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FieldControl, { FieldRows } from '@scenarios/generic-cms/admin/src/components/FieldControl';
import type { FieldDef } from '@scenarios/generic-cms/admin/src/lib/api';

const field = (over: Partial<FieldDef> & { type: FieldDef['type'] }): FieldDef =>
  ({ name: 'f', label: '字段', ...over }) as FieldDef;

/**
 * 状态包装：真实页面里控件是受控的（值存在表单 state 里），
 * 直接喂固定 value 的"假受控"组件会让每次 keystroke 都从初值重新渲染，
 * 于是断言只能拿到最后一个字符——测的就不是组件行为了。
 */
function Harness({
  field: f,
  initial,
  onChange,
}: {
  field: FieldDef;
  initial: unknown;
  onChange: (v: unknown) => void;
}) {
  const [v, setV] = useState<unknown>(initial);
  return (
    <FieldControl
      field={f}
      value={v}
      onChange={(next) => {
        setV(next);
        onChange(next);
      }}
    />
  );
}

describe('FieldControl 基础类型', () => {
  it('text：输入即回传新值', async () => {
    const onChange = vi.fn();
    render(<Harness field={field({ type: 'text' })} initial="旧值" onChange={onChange} />);
    const box = screen.getByDisplayValue('旧值');
    await userEvent.clear(box);
    await userEvent.type(box, '新值');
    expect(onChange).toHaveBeenLastCalledWith('新值');
  });

  it('number：清空时回传 null 而不是 0（0 会被当成有效值写进内容）', async () => {
    const onChange = vi.fn();
    render(<Harness field={field({ type: 'number' })} initial={5} onChange={onChange} />);
    const input = screen.getByRole('spinbutton');
    await userEvent.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('boolean：Switch 切换回传布尔', async () => {
    const onChange = vi.fn();
    render(<Harness field={field({ type: 'boolean' })} initial={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('disabled：所有控件都不可操作', () => {
    render(<FieldControl field={field({ type: 'text' })} value="x" onChange={() => {}} disabled />);
    expect(screen.getByDisplayValue('x')).toBeDisabled();
  });
});

describe('FieldControl 嵌套结构（component）', () => {
  const sub = field({ name: 'label', type: 'text' });

  it('单实例：改子字段时保留同级其他字段（合并而非整体替换）', async () => {
    const onChange = vi.fn();
    const f = field({ type: 'component', fields: [sub, field({ name: 'url', type: 'text' })] });
    render(
      <Harness field={f} initial={{ label: '旧标题', url: 'https://example.com' }} onChange={onChange} />
    );
    const input = screen.getByDisplayValue('旧标题');
    await userEvent.clear(input);
    await userEvent.type(input, '新标题');
    // url 必须还在——整体替换会把用户没碰过的字段清空
    expect(onChange).toHaveBeenLastCalledWith({
      label: '新标题',
      url: 'https://example.com',
    });
  });

  it('repeatable：从空数组添加一项后带上子字段默认值', async () => {
    const onChange = vi.fn();
    const f = field({ type: 'component', repeatable: true, fields: [sub] });
    render(<Harness field={f} initial={[]} onChange={onChange} />);

    expect(screen.getByText('暂无条目')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /添\s*加/ }));
    // text 子字段的空值是 undefined（"没填"），不是 ''——空串会被当成
    // 用户真的填了空白并写进内容
    expect(onChange).toHaveBeenLastCalledWith([{ label: undefined }]);
    // 空态消失 = 真的多了一项（而不是只发了 onChange 却没渲染）
    await waitFor(() => expect(screen.queryByText('暂无条目')).not.toBeInTheDocument());
  });

  it('repeatable：下移交换顺序，第一项上移 / 末项下移均禁用', async () => {
    const onChange = vi.fn();
    const f = field({ type: 'component', repeatable: true, fields: [sub] });
    render(
      <Harness field={f} initial={[{ label: 'A' }, { label: 'B' }]} onChange={onChange} />
    );

    // 边界项的排序按钮必须禁用，否则会把项移出数组
    expect(screen.getByRole('button', { name: '上移第 1 项' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下移第 2 项' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '上移第 2 项' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: '上移第 2 项' }));
    expect(onChange).toHaveBeenLastCalledWith([{ label: 'B' }, { label: 'A' }]);
  });

  it('repeatable：删除只移除对应项', async () => {
    const onChange = vi.fn();
    const f = field({ type: 'component', repeatable: true, fields: [sub] });
    render(
      <Harness
        field={f}
        initial={[{ label: 'A' }, { label: 'B' }, { label: 'C' }]}
        onChange={onChange}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: '删除第 2 项' }));
    expect(onChange).toHaveBeenLastCalledWith([{ label: 'A' }, { label: 'C' }]);
  });

  it('未定义子字段时给出明确提示而不是白屏', () => {
    render(<FieldControl field={field({ type: 'component' })} value={{}} onChange={() => {}} />);
    expect(screen.getByText('该嵌套结构未定义子字段')).toBeInTheDocument();
  });

  it('嵌套过深时熔断，防止脏数据把渲染栈打爆', () => {
    // 自引用型嵌套：不限深度会无限递归直到栈溢出
    const selfRef = field({
      type: 'component',
      name: 'loop',
      fields: [field({ type: 'text' })],
    });
    const deep = field({ type: 'component', name: 'deep', fields: [selfRef] });
    render(<FieldControl field={deep} value={{}} onChange={() => {}} depth={3} />);
    expect(screen.getByText(/嵌套层级过深/)).toBeInTheDocument();
  });
});

describe('FieldRows', () => {
  it('必填字段标星，字段类型可见', () => {
    const fields = [
      field({ name: 'title', type: 'text', required: true }),
      field({ name: 'count', type: 'number' }),
    ];
    render(<FieldRows fields={fields} value={{ title: 'x' }} onChange={() => {}} />);
    expect(screen.getByText('title')).toBeInTheDocument();
    expect(screen.getByText('number')).toBeInTheDocument();
    // 必填星号紧跟字段名
    const label = screen.getByText('title').parentElement;
    expect(label?.textContent).toContain('*');
  });

  it('改一个字段只回传该字段名（不会带上其他字段的旧值）', async () => {
    const onChange = vi.fn();
    const fields = [field({ name: 'a', type: 'text' }), field({ name: 'b', type: 'text' })];
    render(<FieldRows fields={fields} value={{ a: '1', b: '2' }} onChange={onChange} />);
    await userEvent.type(screen.getByDisplayValue('1'), 'x');
    expect(onChange).toHaveBeenLastCalledWith('a', '1x');
  });
});
