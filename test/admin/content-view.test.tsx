// test/admin/content-view.test.tsx
// ContentView：列表 → 编辑弹窗 → 保存。
//
// 核心守一条链路：**表单里改的 slug / status 必须真的随保存请求发出去**。
// 这条链路曾经断过——服务端 ContentService.update 只合并 data，顶层
// slug/status 永远不动，表现为"保存成功但 URL 不变"。前端这里锁一层，
// 请求体不对就直接红。

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContentView from '@scenarios/generic-cms/admin/src/ContentView';
import { stubFetch, ok } from './helpers';

const typeDef = {
  slug: 'post',
  name: '文章',
  fields: [
    { key: 'title', name: 'title', label: '标题', type: 'text', required: true },
    { key: 'count', name: 'count', label: '数量', type: 'number' },
  ],
};

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  slug: 'old-slug',
  status: 'draft',
  type: 'post',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  data: { title: '旧标题', count: 1 },
  ...over,
});

const routes = (items: unknown[] = [entry()]) => ({
  '/api/manage/v1/types': ok({ items: [typeDef] }),
  '/api/v1/post': ok({ items, total: items.length }),
});

describe('ContentView', () => {
  it('列出条目：标题、slug、状态可见', async () => {
    stubFetch({ routes: routes() });
    render(<ContentView />);

    await waitFor(() => expect(screen.getByText('旧标题')).toBeInTheDocument());
    expect(screen.getByText('old-slug')).toBeInTheDocument();
  });

  it('打开编辑框：字段值按类型定义回填', async () => {
    stubFetch({ routes: routes() });
    render(<ContentView />);
    await waitFor(() => expect(screen.getByText('旧标题')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '编 辑' }));

    await waitFor(() => expect(screen.getByDisplayValue('旧标题')).toBeInTheDocument());
    expect(screen.getByDisplayValue('old-slug')).toBeInTheDocument();
    // number 字段回填为数字而非字符串
    expect(screen.getByRole('spinbutton')).toHaveValue('1');
  });

  it('保存：slug 与 status 随请求发出，且不重复塞进 data', async () => {
    const calls = stubFetch({
      routes: {
        ...routes(),
        '/api/manage/v1/post/e1': ok(entry({ slug: 'new-slug', status: 'published' })),
      },
    });
    render(<ContentView />);
    await waitFor(() => expect(screen.getByText('旧标题')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: '编 辑' }));
    await waitFor(() => expect(screen.getByDisplayValue('old-slug')).toBeInTheDocument());

    const slugInput = screen.getByDisplayValue('old-slug');
    await userEvent.clear(slugInput);
    await userEvent.type(slugInput, 'new-slug');
    await userEvent.click(screen.getByRole('button', { name: '保 存' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.path).toContain('/api/manage/v1/post/e1');
    const body = put?.body as Record<string, unknown>;
    expect(body['slug']).toBe('new-slug');
    expect(body['status']).toBe('draft'); // 未改状态时保持原值
    // 顶层 slug/status 与 data 里的同名字段不能同时存在（服务端会各取一份）
    expect(body['data']).toBeUndefined();
  });

  it('新建：不带 slug 键（空 slug 交由服务端生成），status 默认草稿', async () => {
    const calls = stubFetch({
      routes: {
        ...routes([]),
        '/api/manage/v1/post': ok(entry({ id: 'new' })),
      },
    });
    render(<ContentView />);
    await waitFor(() => screen.getByRole('button', { name: /新\s*建/ }));

    await userEvent.click(screen.getByRole('button', { name: /新\s*建/ }));
    // 弹窗内 slug 与 title 都是空的，用 dialog 作用域区分于列表单元格
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(
        within(dialog)
          .getAllByRole('textbox')
          .every((el) => (el as HTMLInputElement).value === '')
      ).toBe(true)
    );
    await userEvent.click(within(dialog).getByRole('button', { name: '保 存' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST');
    const body = post?.body as Record<string, unknown>;
    expect(body['status']).toBe('draft');
    // 空 slug 不该发出去（发了等于显式要求"slug 为空"）
    expect(body['slug']).toBeUndefined();
  });

  it('保存失败：弹窗不关闭并提示错误码', async () => {
    stubFetch({
      routes: {
        ...routes(),
        '/api/manage/v1/post/e1': {
          status: 422,
          json: { error: { code: 'E_VALIDATION', message: '标题必填' } },
        },
      },
    });
    render(<ContentView />);
    await waitFor(() => expect(screen.getByText('旧标题')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: '编 辑' }));
    await waitFor(() => expect(screen.getByDisplayValue('旧标题')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '保 存' }));

    await waitFor(() => expect(screen.getByText(/E_VALIDATION: 标题必填/)).toBeInTheDocument());
    // 弹窗仍在，用户填的内容没被清掉
    expect(screen.getByDisplayValue('旧标题')).toBeInTheDocument();
  });

  it('删除：确认后发 DELETE 并刷新列表', async () => {
    const calls = stubFetch({
      routes: { ...routes(), '/api/manage/v1/post/e1': ok({ ok: true }) },
    });
    render(<ContentView />);
    await waitFor(() => expect(screen.getByText('旧标题')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '删 除' }));
    // 未确认前不得发 DELETE
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    const confirm = await waitFor(() => {
      const box = document.querySelector('.ant-popconfirm');
      if (!box) throw new Error('确认框未出现');
      return within(box as HTMLElement).getByRole('button', { name: '删 除' });
    });
    await userEvent.click(confirm);

    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')?.path).toContain('/api/manage/v1/post/e1');
  });

  it('pendingEdit：按 id 找到条目并直接打开编辑框', async () => {
    const onConsume = () => {};
    stubFetch({ routes: routes() });
    render(<ContentView pendingEdit={{ type: 'post', id: 'e1' }} onConsumePending={onConsume} />);

    await waitFor(() => expect(screen.getByDisplayValue('旧标题')).toBeInTheDocument());
    expect(screen.getByDisplayValue('old-slug')).toBeInTheDocument();
  });

  it('pendingEdit 指向已删除的条目：明确提示而不是静默无反应', async () => {
    stubFetch({ routes: routes([]) });
    render(<ContentView pendingEdit={{ type: 'post', id: 'missing' }} onConsumePending={() => {}} />);

    await waitFor(() => expect(screen.getByText('未找到该条目（可能已被删除）')).toBeInTheDocument());
  });
});
