import type { ApiResponse } from '@engloop/types';
import { clearAuthToken, getAuthToken, notifyUnauthorized } from './auth';

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window === 'undefined' ? 'http://localhost:4000/api' : '/api');

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isForbidden(): boolean {
    return this.status === 403 || this.status === 401;
  }

  get isConnectionProblem(): boolean {
    return this.status === 0 || this.status === 503;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
}

const buildUrl = (path: string, query?: RequestOptions['query']): string => {
  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `${url}?${serialized}` : url;
};

/**
 * Single fetch wrapper for the whole app.
 *
 * Unwraps the `{ success, data, meta }` envelope so callers work with plain
 * data, and turns any `{ success: false }` body into a typed ApiError that the
 * error boundaries can branch on.
 */
export const apiFetch = async <TData>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: TData; meta: Record<string, unknown> }> => {
  const { body, query, headers, ...rest } = options;
  const token = getAuthToken();

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      ...rest,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(headers as Record<string, string> | undefined),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
    });
  } catch (error) {
    throw new ApiError(
      'CONNECTION_FAILED',
      error instanceof Error ? error.message : 'Could not reach the EngLoop API',
      0,
    );
  }

  let payload: ApiResponse<TData> | null = null;
  try {
    payload = (await response.json()) as ApiResponse<TData>;
  } catch {
    payload = null;
  }

  if (response.status === 401) {
    if (path === '/auth/login') clearAuthToken();
    else notifyUnauthorized();
  }

  if (!payload) {
    throw new ApiError('INVALID_RESPONSE', `The API returned a non-JSON response`, response.status);
  }

  if (!payload.success) {
    throw new ApiError(
      payload.error.code,
      payload.error.message,
      response.status,
      payload.error.details,
    );
  }

  return { data: payload.data, meta: payload.meta as Record<string, unknown> };
};

export const api = {
  get: <TData>(path: string, options?: RequestOptions) =>
    apiFetch<TData>(path, { ...options, method: 'GET' }),
  post: <TData>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<TData>(path, { ...options, method: 'POST', body }),
  patch: <TData>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<TData>(path, { ...options, method: 'PATCH', body }),
  delete: <TData>(path: string, options?: RequestOptions) =>
    apiFetch<TData>(path, { ...options, method: 'DELETE' }),
};
