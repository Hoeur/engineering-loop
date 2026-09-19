'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { AUTH_UNAUTHORIZED_EVENT, getAuthToken } from '@/lib/auth';

const loginUrlFor = (pathname: string): string => {
  const requestedPath = `${pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(requestedPath)}`;
};

export const AuthGate = ({ children }: { children: React.ReactNode }): React.JSX.Element | null => {
  const pathname = usePathname();
  const router = useRouter();
  const isPublicRoute = pathname === '/login';
  const [authorized, setAuthorized] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (isPublicRoute) {
      setAuthorized(true);
      return;
    }

    if (getAuthToken()) {
      setAuthorized(true);
      return;
    }

    setAuthorized(false);
    router.replace(loginUrlFor(pathname));
  }, [isPublicRoute, pathname, router]);

  React.useEffect(() => {
    const handleUnauthorized = (): void => {
      if (pathname === '/login') return;
      setAuthorized(false);
      router.replace(loginUrlFor(pathname));
    };

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [pathname, router]);

  if (isPublicRoute) return <>{children}</>;

  if (!authorized) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Checking your session…</span>
      </div>
    );
  }

  return <>{children}</>;
};
