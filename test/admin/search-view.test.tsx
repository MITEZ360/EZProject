// test/admin/search-view.test.tsx
// SearchView：搜索框 → 结果表 → 跳回内容视图。
//
// 盯住三件容易悄悄坏掉的事：
//   1. 必须固定带 status=all —— 否则管理端搜不到草稿（预览门会拦匿名请求）
//   2. 相关度不能显示成 0.000（bm25 / ts_rank 恒 <1，toFixed 会全变 0）
//   3. 空关键词不该发请求

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchView from '@scenarios/generic-cms/admin/src/SearchView';
import { stubFetch, ok } from './helpers';

const hit = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  score: 0.1234,
  document: {
    id: 'e1',
    type: 'post',
    slug: 'hello',
    status: 'published',
    data: { title: '第一篇' },
  },
  ...over,
});

const routes = (items: unknown[] = [hit()], total = 1) => ({
  '/api/v1/search': ok({ items, total }),
  '/api/manage/v1/types': ok({ items: [{ slug: 'post', name: '文章', fields: [] }] }),
});

describe('SearchView', () => {
  it('未搜索时提示"输入关键词开始搜索"，不发搜索请求', async () => {
    const calls = stubFetch({ routes: routes() });
    render(<SearchView onOpen={() => {}} />);

    await waitFor(() => expect(screen.getByText('输入关键词开始搜索')).toBeInTheDocument());
    expect(calls.some((c) => c.path.includes('/api/v1/search'))).toBe(false);
  });

  it('空关键词点搜索：只提示，不发请求', async () => {
    const calls = stubFetch({ routes: routes() });
    render(<SearchView onOpen={() => {}} />);
    await waitFor(() => screen.getByPlaceholderText(/搜索标题/));

    await userEvent.type(screen.getByPlaceholderText(/搜索标题/), '   ');
    await userEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));

    await waitFor(() => expect(screen.getByText('请输入关键词')).toBeInTheDocument());
    expect(calls.some((c) => c.path.includes('/api/v1/search'))).toBe(false);
  });

  it('搜索请求固定带 status=all（管理端要能搜到草稿）', async () => {
    const calls = stubFetch({ routes: routes() });
    render(<SearchView onOpen={() => {}} />);
    await waitFor(() => screen.getByPlaceholderText(/搜索标题/));

    await userEvent.type(screen.getByPlaceholderText(/搜索标题/), '中文');
    await userEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));

    await waitFor(() => expect(screen.getByText('共 1 条命中')).toBeInTheDocument());
    const req = calls.find((c) => c.path.includes('/api/v1/search'));
    expect(req).toBeDefined();
    expect(req?.path).toContain('status=all');
    expect(req?.path).toContain('q=%E4%B8%AD%E6%96%87'); // q=中文
  });

  it('结果显示标题、状态与相关度；相关度不是 0.000', async () => {
    stubFetch({ routes: routes() });
    render(<SearchView onOpen={() => {}} />);
    await waitFor(() => screen.getByPlaceholderText(/搜索标题/));
    await userEvent.type(screen.getByPlaceholderText(/搜索标题/), '第一');
    await userEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));

    await waitFor(() => expect(screen.getByText('第一篇')).toBeInTheDocument());
    expect(screen.getByText('已发布')).toBeInTheDocument();
    // toPrecision(3) → "0.123"；toFixed(3) 会显示 0.000，相关度就没用了
    expect(screen.getByText('0.123')).toBeInTheDocument();
    expect(screen.queryByText('0.000')).not.toBeInTheDocument();
  });

  it('草稿结果显示为"草稿"标签', async () => {
    stubFetch({
      routes: routes([
        hit({
          document: {
            id: 'e2',
            type: 'post',
            slug: 'draft-one',
            status: 'draft',
            data: { title: '草稿一篇' },
          },
        }),
      ]),
    });
    render(<SearchView onOpen={() => {}} />);
    await waitFor(() => screen.getByPlaceholderText(/搜索标题/));
    await userEvent.type(screen.getByPlaceholderText(/搜索标题/), '草稿');
    await userEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));

    await waitFor(() => expect(screen.getByText('草稿一篇')).toBeInTheDocument());
    expect(screen.getByText('草稿')).toBeInTheDocument();
  });

  it('点"打开"回调带上正确的类型与条目 id', async () => {
    const onOpen = vi.fn();
    stubFetch({ routes: routes() });
    render(<SearchView onOpen={onOpen} />);
    await waitFor(() => screen.getByPlaceholderText(/搜索标题/));
    await userEvent.type(screen.getByPlaceholderText(/搜索标题/), '第一');
    await userEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));

    await waitFor(() => expect(screen.getByText('第一篇')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: '打 开' }));
    expect(onOpen).toHaveBeenCalledWith('post', 'e1');
  });

  it('无命中时明确提示"没有命中"', async () => {
    stubFetch({ routes: routes([], 0) });
    render(<SearchView onOpen={() => {}} />);
    await waitFor(() => screen.getByPlaceholderText(/搜索标题/));
    await userEvent.type(screen.getByPlaceholderText(/搜索标题/), '不存在的词');
    await userEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));

    await waitFor(() => expect(screen.getByText('没有命中')).toBeInTheDocument());
    expect(screen.getByText('共 0 条命中')).toBeInTheDocument();
  });

  it('搜索失败：显示错误码与消息，而不是空表', async () => {
    stubFetch({
      routes: {
        '/api/v1/search': {
          status: 403,
          json: { error: { code: 'E_PREVIEW', message: '需要凭证才能搜索草稿' } },
        },
        '/api/manage/v1/types': ok({ items: [] }),
      },
    });
    render(<SearchView onOpen={() => {}} />);
    await waitFor(() => screen.getByPlaceholderText(/搜索标题/));
    await userEvent.type(screen.getByPlaceholderText(/搜索标题/), 'x');
    await userEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));

    await waitFor(() =>
      expect(screen.getByText('E_PREVIEW: 需要凭证才能搜索草稿')).toBeInTheDocument()
    );
  });
});
