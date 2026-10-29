import React from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider, message } from 'antd';
import { AxiosError, type AxiosResponse } from 'axios';
import api from './api';
import ReceivablesPage from './pages/Receivables';

const originalAdapter = api.defaults.adapter;
let queryClient: QueryClient;

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});

afterEach(async () => {
  await act(async () => {
    cleanup();
    queryClient?.clear();
    message.destroy();
  });
  api.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
});

it('reports partial batch confirmation, retains failures, and disables non-draft selections', async () => {
  // Controlled HTTP outcomes exercise the real page's partial-failure handling.
  // Real backend money and permissions are verified in pytest/browser checks.
  const rows = [
    { id: 'draft-ok', project_id: 'synthetic-project', payer: '合成成功付款方', amount: 10, status: 'draft' },
    { id: 'draft-failed', project_id: 'synthetic-project', payer: '合成失败付款方', amount: 20, status: 'draft' },
    { id: 'confirmed', project_id: 'synthetic-project', payer: '合成已确认付款方', amount: 30, status: 'confirmed' },
  ];
  const submitted: string[] = [];
  const getComputedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => getComputedStyle(element));
  api.defaults.adapter = async config => {
    let data: unknown = [];
    if (config.url === '/receipts') data = rows.map(row => ({ ...row }));
    if (config.url === '/projects') data = { items: [{ id: 'synthetic-project', code: 'SYNTHETIC' }] };
    if (config.url?.endsWith('/confirm')) {
      submitted.push(config.url);
      if (config.url.includes('draft-failed')) {
        const response: AxiosResponse = { status: 400, statusText: 'Bad Request', config, headers: {}, data: { detail: '合成冲突' } };
        throw new AxiosError('Synthetic conflict', 'ERR_BAD_REQUEST', config, undefined, response);
      }
      rows[0].status = 'confirmed';
      data = { ok: true };
    }
    return { status: 200, statusText: 'OK', config, headers: {}, data };
  };
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><ConfigProvider><AntApp><ReceivablesPage /></AntApp></ConfigProvider></QueryClientProvider>);
  const successRow = await screen.findByRole('row', { name: /合成成功付款方/ });
  const failedRow = screen.getByRole('row', { name: /合成失败付款方/ });
  const confirmedRow = screen.getByRole('row', { name: /合成已确认付款方/ });
  expect(within(confirmedRow).getByRole('checkbox')).toBeDisabled();
  fireEvent.click(within(successRow).getByRole('checkbox'));
  fireEvent.click(within(failedRow).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '批量确认 (2)' }));
  await waitFor(() => expect(screen.getByText('已确认 1 笔，1 笔失败，请核对后重试')).toBeVisible());
  expect(submitted.sort()).toEqual(['/receipts/draft-failed/confirm', '/receipts/draft-ok/confirm']);
  expect(screen.getByRole('button', { name: '批量确认 (1)' })).toBeVisible();
  await waitFor(() => expect(within(screen.getByRole('row', { name: /合成成功付款方/ })).getByRole('checkbox')).toBeDisabled());
  expect(within(screen.getByRole('row', { name: /合成失败付款方/ })).getByRole('checkbox')).toBeChecked();
});
