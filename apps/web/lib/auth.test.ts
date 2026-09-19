import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTH_TOKEN_STORAGE_KEY,
  clearAuthToken,
  getAuthToken,
  safeNextPath,
  setAuthToken,
} from './auth';

describe('auth storage', () => {
  afterEach(() => window.localStorage.clear());

  it('stores and clears the bearer token', () => {
    expect(getAuthToken()).toBeNull();
    setAuthToken('signed-jwt');
    expect(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('signed-jwt');
    expect(getAuthToken()).toBe('signed-jwt');
    clearAuthToken();
    expect(getAuthToken()).toBeNull();
  });

  it('only accepts local non-login return paths', () => {
    expect(safeNextPath('/engineering/tasks?status=RUNNING')).toBe(
      '/engineering/tasks?status=RUNNING',
    );
    expect(safeNextPath('https://example.com')).toBe('/');
    expect(safeNextPath('//example.com')).toBe('/');
    expect(safeNextPath('/login?next=/settings')).toBe('/');
  });
});
