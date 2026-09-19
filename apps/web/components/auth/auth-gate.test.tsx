import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TOKEN_STORAGE_KEY, notifyUnauthorized } from '@/lib/auth';
import { AuthGate } from './auth-gate';

const navigation = vi.hoisted(() => ({
  pathname: '/projects',
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
}));

describe('AuthGate', () => {
  afterEach(() => {
    window.localStorage.clear();
    navigation.replace.mockClear();
  });

  it('renders protected content when a token exists', () => {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'signed-jwt');
    render(
      <AuthGate>
        <p>Protected content</p>
      </AuthGate>,
    );

    expect(screen.getByText('Protected content')).toBeVisible();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('redirects to login when the active token becomes unauthorized', () => {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'expired-jwt');
    render(
      <AuthGate>
        <p>Protected content</p>
      </AuthGate>,
    );

    act(() => notifyUnauthorized());

    expect(navigation.replace).toHaveBeenCalledWith('/login?next=%2Fprojects');
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });
});
