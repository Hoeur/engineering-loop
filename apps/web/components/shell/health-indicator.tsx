'use client';

import type * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger, cn } from '@engloop/ui';
import { useHealth } from '@/lib/queries';

/** Small dot showing whether the control plane and its dependencies are up. */
export const HealthIndicator = (): React.JSX.Element => {
  const { data, isLoading, isError } = useHealth();

  const state = isLoading
    ? { tone: 'bg-muted-foreground/40', label: 'Checking control plane…' }
    : isError
      ? { tone: 'bg-danger', label: 'API unreachable' }
      : data?.status === 'ok'
        ? { tone: 'bg-success', label: 'Control plane healthy' }
        : { tone: 'bg-warning', label: 'Control plane degraded' };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full', state.tone)} />
          <span className="hidden lg:inline">
            {isError ? 'Offline' : data?.status === 'ok' ? 'Healthy' : 'Degraded'}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{state.label}</TooltipContent>
    </Tooltip>
  );
};
