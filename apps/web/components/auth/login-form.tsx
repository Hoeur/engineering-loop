'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Workflow } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@engloop/ui';
import { api, ApiError } from '@/lib/api-client';
import { getAuthToken, setAuthToken } from '@/lib/auth';

interface LoginResult {
  token: string;
  expiresIn: string;
  user: {
    id: string;
    email: string;
    name: string;
    organizationId: string;
    role: string;
  };
}

export const LoginForm = ({ nextPath }: { nextPath: string }): React.JSX.Element => {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (getAuthToken()) router.replace(nextPath);
  }, [nextPath, router]);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { data } = await api.post<LoginResult>('/auth/login', { email, password });
      setAuthToken(data.token);
      router.replace(nextPath);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Sign in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Workflow className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-tight">EngLoop</span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sign in</CardTitle>
            <CardDescription>Use your EngLoop account to open the control plane.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-xs font-medium">
                  Email
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password" className="text-xs font-medium">
                  Password
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                />
              </div>

              {error ? (
                <div
                  className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger-strong"
                  role="alert"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              ) : null}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
