import type * as React from 'react';
import { LoginForm } from '@/components/auth/login-form';
import { safeNextPath } from '@/lib/auth';

interface LoginPageProps {
  searchParams: Promise<{ next?: string | string[] }>;
}

export default async function LoginPage({
  searchParams,
}: LoginPageProps): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <LoginForm nextPath={safeNextPath(params.next)} />;
}
