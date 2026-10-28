import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import App from './App';
import ArchiveShell, { MAINLINE_GUIDE } from './components/archive/ArchiveShell';

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderEntry(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfigProvider>
        <MemoryRouter initialEntries={[path]}>
          <ArchiveShell><App /></ArchiveShell>
        </MemoryRouter>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}

describe('真实 App 登录与门户入口的归档说明', () => {
  it('keeps the internal login form and a safe mainline documentation link', () => {
    renderEntry('/login');
    expect(screen.getByRole('complementary', { name: 'DeepSeek 版归档说明' })).toBeVisible();
    expect(screen.getByLabelText('用户名')).toBeVisible();
    expect(screen.getByLabelText('密码')).toBeVisible();
    const link = screen.getByRole('link', { name: '查看主线启动与使用说明' });
    expect(link).toHaveAttribute('href', MAINLINE_GUIDE);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/勿录入真实客户或财务资料/)).toBeVisible();
  });

  it('also appears on the separate portal login and retains unported capabilities', () => {
    renderEntry('/portal');
    expect(screen.getByLabelText('客户门户用户名')).toBeVisible();
    expect(screen.getByLabelText('客户门户密码')).toBeVisible();
    expect(screen.getByText('DeepSeek 版 · 归档演示')).toBeVisible();
    fireEvent.click(screen.getByText('尚未迁移的能力'));
    expect(screen.getByText(/客户门户、审批、甘特与日历/)).toBeVisible();
    expect(screen.getByText(/文档多版本、保存视图与个人改密保留待确认/)).toBeVisible();
    expect(screen.getByText(/不代表 Windows 双击/)).toBeVisible();
  });

  it('does not allow an old portal profile without its own token to enter the portal', () => {
    localStorage.setItem('portal_user', JSON.stringify({ id: 'old-profile', username: 'old' }));
    localStorage.setItem('token', 'internal-session');
    renderEntry('/portal');
    expect(screen.getByLabelText('客户门户用户名')).toBeVisible();
    expect(localStorage.getItem('token')).toBe('internal-session');
  });
});
