import type * as React from 'react';
import { cn } from '@engloop/ui';

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  className?: string;
}

export const PageHeader = ({
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: PageHeaderProps): React.JSX.Element => (
  <header
    className={cn(
      'flex flex-col gap-3 pb-5 sm:flex-row sm:items-start sm:justify-between',
      className,
    )}
  >
    <div className="min-w-0 space-y-1">
      {breadcrumbs}
      <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
      {description ? (
        <p className="max-w-3xl text-xs text-muted-foreground sm:text-sm">{description}</p>
      ) : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </header>
);
