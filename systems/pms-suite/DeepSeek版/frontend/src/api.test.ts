import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import api, { portalApi, fetchPortalProjects, login } from './api';

const internalAdapter = api.defaults.adapter;
const portalAdapter = portalApi.defaults.adapter;

function unauthorized(config: InternalAxiosRequestConfig) {
  const response: AxiosResponse = {
    status: 401, statusText: 'Unauthorized', config, headers: {}, data: { detail: '登录已过期' },
  };
  return Promise.reject(new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, response));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/login');
});

afterEach(() => {
  api.defaults.adapter = internalAdapter;
  portalApi.defaults.adapter = portalAdapter;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('archive session regressions', () => {
  it('sends each identity only through its own API client', async () => {
    localStorage.setItem('token', 'internal-test-token');
    localStorage.setItem('portal_token', 'portal-test-token');
    const received: string[] = [];
    const capture = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      received.push(String(config.headers.Authorization));
      return { status: 200, statusText: 'OK', config, headers: {}, data: [] };
    };
    api.defaults.adapter = capture;
    portalApi.defaults.adapter = capture;
    await api.get('/projects');
    await fetchPortalProjects();
    expect(received).toEqual(['Bearer internal-test-token', 'Bearer portal-test-token']);
  });

  it('rejects simultaneous internal 401s and permits a subsequent login', async () => {
    api.defaults.adapter = unauthorized;
    const settled = await Promise.allSettled([api.get('/projects'), api.get('/tasks'), api.get('/customers')]);
    expect(settled.map(result => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
    api.defaults.adapter = async (config) => ({
      status: 200, statusText: 'OK', config, headers: {},
      data: { access_token: 'new-internal-session', user: { id: 'internal-user' } },
    });
    await login('synthetic-user', 'Synthetic@123');
    expect(localStorage.getItem('token')).toBe('new-internal-session');
    expect(JSON.parse(localStorage.getItem('user')!)).toEqual({ id: 'internal-user' });
  });

  it('expires only the portal identity and signals the portal page', async () => {
    localStorage.setItem('token', 'internal-session');
    localStorage.setItem('user', '{"id":"internal-user"}');
    localStorage.setItem('portal_token', 'expired-portal-session');
    localStorage.setItem('portal_user', '{"id":"portal-user"}');
    const expired = vi.fn();
    window.addEventListener('pms:portal-session-expired', expired);
    try {
      portalApi.defaults.adapter = unauthorized;
      await expect(fetchPortalProjects()).rejects.toBeInstanceOf(AxiosError);
      expect(localStorage.getItem('portal_token')).toBeNull();
      expect(localStorage.getItem('portal_user')).toBeNull();
      expect(localStorage.getItem('token')).toBe('internal-session');
      expect(localStorage.getItem('user')).toBe('{"id":"internal-user"}');
      expect(expired).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('pms:portal-session-expired', expired);
    }
  });

  it('keeps the portal usable after repeated incorrect passwords', async () => {
    localStorage.setItem('token', 'internal-session');
    portalApi.defaults.adapter = unauthorized;
    const settled = await Promise.allSettled([
      portalApi.post('/portal/login', {}), portalApi.post('/portal/login', {}),
    ]);
    expect(settled.map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(localStorage.getItem('token')).toBe('internal-session');
    portalApi.defaults.adapter = async config => ({ status: 200, statusText: 'OK', config, headers: {}, data: { access_token: 'portal-retry' } });
    await expect(portalApi.post('/portal/login', {})).resolves.toMatchObject({ data: { access_token: 'portal-retry' } });
  });
});
