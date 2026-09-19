import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api-client';
import { AUTH_TOKEN_STORAGE_KEY, AUTH_UNAUTHORIZED_EVENT } from './auth';

describe('apiFetch authentication', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('attaches a stored JWT as a bearer token', async () => {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'signed-jwt');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { ok: true }, meta: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch<{ ok: boolean }>('/health');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer signed-jwt' }),
      }),
    );
  });

  it('clears the token and announces an unauthorized protected response', async () => {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'expired-jwt');
    const listener = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, listener);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
            meta: {},
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await expect(apiFetch('/projects')).rejects.toMatchObject({ status: 401 });
    expect(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, listener);
  });

  it('does not announce an expected invalid-credentials response', async () => {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'stale-jwt');
    const listener = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, listener);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
            meta: {},
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await expect(apiFetch('/auth/login', { method: 'POST' })).rejects.toMatchObject({
      status: 401,
    });
    expect(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, listener);
  });

  it('clears authentication even when an unauthorized response is not JSON', async () => {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'expired-jwt');
    const listener = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, listener);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })),
    );

    await expect(apiFetch('/projects')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, listener);
  });
});
