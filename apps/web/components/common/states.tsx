'use client';

import type * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Ban, FileQuestion, Inbox, Loader2, PlugZap, RefreshCw } from 'lucide-react';
import { Button, Card, Skeleton, cn } from '@engloop/ui';
import { ApiError } from '@/lib/api-client';

/**
 * Every screen in EngLoop renders one of these instead of a blank area
 * (spec section 37). They are deliberately small and composable.
 */

export const LoadingState = ({
  label = 'Loading…',
  rows = 4,
  className,
}: {
  label?: string;
  rows?: number;
  className?: string;
}): React.JSX.Element => (
  <div className={cn('space-y-3', className)} role="status" aria-live="polite">
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {label}
    </div>
    {Array.from({ length: rows }).map((_, index) => (
      <Skeleton key={index} className="h-12 w-full" />
    ))}
  </div>
);

export const EmptyState = ({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ElementType;
  className?: string;
}): React.JSX.Element => (
  <Card className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Icon className="h-5 w-5" />
    </div>
    <div className="space-y-1">
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="mx-auto max-w-md text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
    {action}
  </Card>
);

export const NotFoundState = ({
  entity,
  backHref = '/',
}: {
  entity: string;
  backHref?: string;
}): React.JSX.Element => (
  <EmptyState
    icon={FileQuestion}
    title={`${entity} not found`}
    description="It may have been deleted, or the link is out of date."
    action={
      <Button asChild variant="outline" size="sm">
        <Link href={backHref}>Go back</Link>
      </Button>
    }
  />
);

export const PermissionDeniedState = (): React.JSX.Element => (
  <EmptyState
    icon={Ban}
    title="You do not have access to this"
    description="Ask an organization owner to grant you access, then reload the page."
  />
);

export const ConnectionProblemState = ({
  onRetry,
}: {
  onRetry?: () => void;
}): React.JSX.Element => (
  <EmptyState
    icon={PlugZap}
    title="Cannot reach the EngLoop API"
    description="The control plane is not responding. Check that the API and database containers are running (pnpm docker:up), then retry."
    action={
      onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      ) : null
    }
  />
);

/** Picks the right state for a thrown error so screens never branch by hand. */
export const ErrorState = ({
  error,
  onRetry,
  entity = 'Resource',
}: {
  error: unknown;
  onRetry?: () => void;
  entity?: string;
}): React.JSX.Element => {
  if (error instanceof ApiError) {
    if (error.isConnectionProblem) return <ConnectionProblemState onRetry={onRetry} />;
    if (error.isForbidden) return <PermissionDeniedState />;
    if (error.isNotFound) return <NotFoundState entity={entity} />;
  }

  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  const code = error instanceof ApiError ? error.code : 'UNKNOWN';

  return (
    <EmptyState
      icon={AlertTriangle}
      title="Something went wrong"
      description={`${code}: ${message}`}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </Button>
        ) : null
      }
    />
  );
};

/** Wraps a query result so a screen renders the right state without ceremony. */
export const QueryBoundary = <TData,>({
  query,
  children,
  entity,
  loadingLabel,
  emptyCheck,
  empty,
}: {
  query: {
    data: TData | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => void;
  };
  children: (data: TData) => React.ReactNode;
  entity?: string;
  loadingLabel?: string;
  emptyCheck?: (data: TData) => boolean;
  empty?: React.ReactNode;
}): React.JSX.Element => {
  if (query.isLoading) return <LoadingState label={loadingLabel} />;
  if (query.isError) {
    return <ErrorState error={query.error} entity={entity} onRetry={() => query.refetch()} />;
  }
  if (query.data === undefined) return <ErrorState error={new Error('No data returned')} />;
  if (emptyCheck?.(query.data) && empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
};
