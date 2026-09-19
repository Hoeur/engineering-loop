'use client';

import type * as React from 'react';
import { cn } from '@engloop/ui';

export interface BarDatum {
  label: string;
  value: number;
  formatted?: string;
}

/**
 * A deliberately small, dependency-free bar chart.
 *
 * The dashboards need trend shape and comparison, not a full charting runtime;
 * this keeps the client bundle honest and renders identically in both themes.
 */
export const SimpleBarChart = ({
  data,
  className,
  emptyLabel = 'No data in this range.',
  barClassName = 'bg-info',
}: {
  data: BarDatum[];
  className?: string;
  emptyLabel?: string;
  barClassName?: string;
}): React.JSX.Element => {
  if (data.length === 0) {
    return <p className="py-8 text-center text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  const max = Math.max(...data.map((datum) => datum.value), 1);

  return (
    <div className={cn('space-y-1.5', className)}>
      {data.map((datum) => (
        <div key={datum.label} className="flex items-center gap-2">
          <span className="w-20 shrink-0 truncate text-[11px] text-muted-foreground">
            {datum.label}
          </span>
          <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted">
            <div
              className={cn('h-full rounded-sm transition-all', barClassName)}
              style={{ width: `${String(Math.max(2, (datum.value / max) * 100))}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums">
            {datum.formatted ?? datum.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export const Sparkline = ({
  values,
  className,
}: {
  values: number[];
  className?: string;
}): React.JSX.Element => {
  if (values.length < 2) return <div className={cn('h-8', className)} />;
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 30 - (value / max) * 28;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className={cn('h-8 w-full', className)}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};
