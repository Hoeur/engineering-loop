import type * as React from 'react';
import Link from 'next/link';
import { cn } from '@engloop/ui';
import type { LucideIcon } from 'lucide-react';

export interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
  href?: string;
}

const TONE_CLASSES: Record<NonNullable<MetricCardProps['tone']>, string> = {
  neutral: 'text-foreground',
  success: 'text-success-strong',
  warning: 'text-warning-strong',
  danger: 'text-danger-strong',
  info: 'text-info-strong',
  accent: 'text-accent-strong',
};

export const MetricCard = ({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  href,
}: MetricCardProps): React.JSX.Element => {
  const content = (
    <div className="flex h-full flex-col justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-xs transition-colors hover:border-foreground/15">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
      </div>
      <div className="space-y-0.5">
        <p className={cn('text-2xl font-semibold tabular-nums leading-none', TONE_CLASSES[tone])}>
          {value}
        </p>
        {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );

  return href ? (
    <Link
      href={href}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
    >
      {content}
    </Link>
  ) : (
    content
  );
};
