export const AUTH_TOKEN_STORAGE_KEY = 'engloop.auth.token';
export const AUTH_UNAUTHORIZED_EVENT = 'engloop:unauthorized';

export const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
};

export const setAuthToken = (token: string): void => {
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
};

export const clearAuthToken = (): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

export const notifyUnauthorized = (): void => {
  if (typeof window === 'undefined') return;
  clearAuthToken();
  window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
};

export const safeNextPath = (value: string | string[] | undefined): string => {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate?.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/login')) {
    return '/';
  }
  return candidate;
};
