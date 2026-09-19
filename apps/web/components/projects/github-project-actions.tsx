'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Github, Loader2, Lock, RefreshCw } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@engloop/ui';
import { ApiError } from '@/lib/api-client';
import {
  useGitHubInstallations,
  useGitHubRepositories,
  useImportGitHubRepository,
  useStartGitHubAuthorization,
} from '@/lib/queries';

const errorMessage = (error: unknown): string =>
  error instanceof ApiError || error instanceof Error ? error.message : 'GitHub request failed';

export const GitHubProjectActions = (): React.JSX.Element => {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [installationId, setInstallationId] = React.useState('');
  const installations = useGitHubInstallations();
  const repositories = useGitHubRepositories(installationId);
  const startAuthorization = useStartGitHubAuthorization();
  const importRepository = useImportGitHubRepository();

  React.useEffect(() => {
    const first = installations.data?.items[0]?.installationId;
    if (!installationId && first) setInstallationId(first);
  }, [installationId, installations.data]);

  // `mutate`, not `mutateAsync`: a failure is shown inline below the button instead of
  // escaping as an unhandled rejection (which Next.js dev turns into a full-page overlay).
  const connect = (): void => {
    startAuthorization.mutate(undefined, {
      onSuccess: (result) => window.location.assign(result.authorizationUrl),
    });
  };

  const connected = (installations.data?.items.length ?? 0) > 0;
  const pending = installations.isLoading || startAuthorization.isPending;

  return (
    <>
      <Button
        type="button"
        variant={connected ? 'outline' : 'default'}
        disabled={pending}
        onClick={() => {
          if (connected) setOpen(true);
          else connect();
        }}
      >
        {pending ? <Loader2 className="animate-spin" /> : <Github />}
        {connected ? 'Import from GitHub' : 'Connect GitHub'}
      </Button>

      {installations.isError ? (
        <p className="w-full text-xs text-danger sm:max-w-sm">
          {errorMessage(installations.error)}
        </p>
      ) : null}
      {startAuthorization.isError ? (
        <p className="w-full text-xs text-danger sm:max-w-sm">
          {errorMessage(startAuthorization.error)}
        </p>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import a GitHub repository</DialogTitle>
            <DialogDescription>
              EngLoop reads canonical metadata from your GitHub App installation and creates a
              project connected to that repository.
            </DialogDescription>
          </DialogHeader>

          <Select value={installationId} onValueChange={setInstallationId}>
            <SelectTrigger aria-label="GitHub installation">
              <SelectValue placeholder="Choose an installation" />
            </SelectTrigger>
            <SelectContent>
              {(installations.data?.items ?? []).map((installation) => (
                <SelectItem key={installation.id} value={installation.installationId}>
                  {installation.accountLogin}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {repositories.isLoading ? (
            <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading repositories…
            </div>
          ) : repositories.isError ? (
            <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
              <p>{errorMessage(repositories.error)}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void repositories.refetch()}
              >
                <RefreshCw /> Retry
              </Button>
            </div>
          ) : (repositories.data?.items.length ?? 0) === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              This installation has no accessible repositories.
            </p>
          ) : (
            <ScrollArea className="max-h-[55vh] pr-3">
              <div className="space-y-2">
                {(repositories.data?.items ?? []).map((repository) => (
                  <div
                    key={repository.id}
                    className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{repository.fullName}</p>
                        {repository.private ? (
                          <Badge tone="neutral">
                            <Lock className="mr-1 h-3 w-3" /> Private
                          </Badge>
                        ) : null}
                        {repository.archived ? <Badge tone="warning">Archived</Badge> : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {repository.description ?? `${repository.defaultBranch} branch`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        repository.imported || repository.archived || importRepository.isPending
                      }
                      onClick={() => {
                        importRepository.mutate(
                          { installationId, repositoryId: repository.id },
                          {
                            onSuccess: ({ project }) => {
                              setOpen(false);
                              router.push(`/projects/${project.id}`);
                            },
                          },
                        );
                      }}
                    >
                      {repository.imported ? 'Imported' : 'Import'}
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {importRepository.isError ? (
            <p className="text-sm text-danger">{errorMessage(importRepository.error)}</p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
};
