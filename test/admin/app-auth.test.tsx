// test/admin/app-auth.test.tsx
// App 壳的认证门测试。
//
// 这不是"补覆盖率"，而是**守住一个已经真实发生过的缺陷**：
// 原先 probe() 里 setAuthed(true) 写在 hasSession() 判断之外，
// healthz 一通就放行——未登录也能进后台界面。typecheck / lint / build
// 全都看不出来（它们对一个死掉的门视而不见），只有浏览器真机点出来。
// 所以这里的核心用例必须能在"门被改回坏的"时变红。

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@scenarios/generic-cms/admin/src/App';
import { setToken, clearTokens } from '@scenarios/generic-cms/admin/src/lib/api';
import { stubFetch, ok } from './helpers';

describe('App 认证门', () => {
  beforeEach(() => {
    clearTokens();
  });

  it('无会话时停在登录页：healthz 通过也不放行', async () => {
    stubFetch({ routes: { '/healthz': ok({ ok: true }) }, fallback: ok({ items: [] }) });
    render(<App />);

    await waitFor(() => expect(screen.getByText('内容管理后台')).toBeInTheDocument());
    // 关键断言：侧边栏不该出现
    expect(screen.queryByText('类型管理')).not.toBeInTheDocument();
    expect(screen.queryByText('审计日志')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('邮箱')).toBeInTheDocument();
  });

  it('无会话时绝不请求 /auth/me（未登录就发请求是门失守的信号）', async () => {
    const calls = stubFetch({
      routes: { '/healthz': ok({ ok: true }) },
      fallback: ok({ items: [] }),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('邮箱')).toBeInTheDocument());

    expect(calls.some((c) => c.path.includes('/auth/me'))).toBe(false);
  });

  it('有会话且令牌有效：me 通过后进入后台', async () => {
    setToken('valid-token');
    stubFetch({
      routes: {
        '/auth/me': ok({ user: { id: 'u1', email: 'a@b.c' } }),
        '/types': ok({ items: [] }),
      },
      fallback: ok({ items: [] }),
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText('类型管理')).toBeInTheDocument());
    expect(screen.queryByPlaceholderText('邮箱')).not.toBeInTheDocument();
  });

  it('有会话但令牌失效（401）：留在登录页，不进入后台', async () => {
    setToken('expired-token');
    stubFetch({
      routes: {
        '/auth/refresh': { status: 401, json: { error: { code: 'E_AUTH', message: '刷新令牌无效' } } },
        '/auth/me': { status: 401, json: { error: { code: 'E_AUTH', message: '令牌无效' } } },
      },
      fallback: ok({ items: [] }),
    });
    render(<App />);

    await waitFor(() => expect(screen.getByPlaceholderText('邮箱')).toBeInTheDocument());
    expect(screen.queryByText('类型管理')).not.toBeInTheDocument();
  });

  it('登录成功后进入后台', async () => {
    const calls = stubFetch({
      routes: {
        '/auth/login': ok({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 }),
        '/types': ok({ items: [] }),
      },
      fallback: ok({ items: [] }),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('邮箱')).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText('邮箱'), 'admin@example.com');
    await userEvent.type(screen.getByPlaceholderText('密码'), 'pw123456');
    // antd 会把中文按钮文字渲染成 "登 录"（字距样式），用正则避开空格差异
    await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    await waitFor(() => expect(screen.getByText('类型管理')).toBeInTheDocument());
    const login = calls.find((c) => c.path.includes('/auth/login'));
    expect(login?.body).toMatchObject({ email: 'admin@example.com', password: 'pw123456' });
  });

  it('登录失败：留在登录页并提示错误', async () => {
    stubFetch({
      routes: {
        '/auth/login': {
          status: 401,
          json: { error: { code: 'E_AUTH', message: '邮箱或密码不正确' } },
        },
      },
      fallback: ok({ items: [] }),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('邮箱')).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText('邮箱'), 'a@b.c');
    await userEvent.type(screen.getByPlaceholderText('密码'), 'wrong');
    // antd 会把中文按钮文字渲染成 "登 录"（字距样式），用正则避开空格差异
    await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    await waitFor(() => expect(screen.getByText('邮箱或密码不正确')).toBeInTheDocument());
    expect(screen.queryByText('类型管理')).not.toBeInTheDocument();
  });
});
