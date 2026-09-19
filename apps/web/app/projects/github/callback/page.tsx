'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { ApiError } from '@/lib/api-client';
import { useCompleteGitHubAuthorization, useStartGitHubAuthorization } from '@/lib/queries';

export default function GitHubCallbackPage(): React.JSX.Element {
  return (
    <React.Suspense fallback={<GitHubCallbackCard />}>
      <GitHubCallbackContent />
    </React.Suspense>
  );
}

const GitHubCallbackContent = (): React.JSX.Element => {
  const router = useRouter();
  const params = useSearchParams();
  const completion = useCompleteGitHubAuthorization();
  const restart = useStartGitHubAuthorization();
  const started = React.useRef(false);
  // Local state rather than the mutation's own status: under React Strict Mode the
  // mount-time effect double-invocation detaches the mutation observer, so its
  // status and `mutate` callbacks never update and the page would spin forever.
  const [success, setSuccess] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  const state = params.get('state');
  const code = params.get('code');
  const installationId = params.get('installation_id') ?? undefined;
  const setupAction = params.get('setup_action') ?? undefined;

  React.useEffect(() => {
    if (started.current || !code) return;
    started.current = true;
    const run = async (): Promise<void> => {
      try {
        if (state) {
          await completion.mutateAsync({ state, code, installationId, setupAction });
          setSuccess(true);
          router.replace('/projects?github=connected');
          return;
        }
        // Installing the App from github.com sends the user here without our state.
        // That code is not bound to this session, so it is never used: start a fresh,
        // state-bound authorization instead — GitHub returns at once for a user who
        // has just authorized the App.
        const restarted = await restart.mutateAsync();
        window.location.assign(restarted.authorizationUrl);
      } catch (caught) {
        setError(caught);
      }
    };
    void run();
  }, [code, completion, installationId, restart, router, setupAction, state]);

  return (
    <GitHubCallbackCard
      missing={!code}
      error={error}
      success={success}
      onReturn={() => router.replace('/projects')}
    />
  );
};

const GitHubCallbackCard = ({
  missing = false,
  error,
  success = false,
  onReturn,
}: {
  missing?: boolean;
  error?: unknown;
  success?: boolean;
  onReturn?: () => void;
}): React.JSX.Element => {
  const installUrl =
    error instanceof ApiError && typeof error.details?.installUrl === 'string'
      ? error.details.installUrl
      : undefined;

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {missing || error ? (
              <XCircle className="text-danger" />
            ) : success ? (
              <CheckCircle2 className="text-success" />
            ) : (
              <Loader2 className="animate-spin" />
            )}
            Connect GitHub
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            {missing
              ? 'GitHub did not return the authorization code required to connect.'
              : error
                ? error instanceof ApiError || error instanceof Error
                  ? error.message
                  : 'GitHub connection failed.'
                : 'Verifying the installation and its organization ownership…'}
          </p>
          {missing || error ? (
            <div className="flex flex-wrap gap-2">
              {installUrl ? (
                <Button type="button" onClick={() => window.location.assign(installUrl)}>
                  Install on GitHub
                </Button>
              ) : null}
              <Button type="button" variant={installUrl ? 'outline' : 'default'} onClick={onReturn}>
                Return to projects
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
};
