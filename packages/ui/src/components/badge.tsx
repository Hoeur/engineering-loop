import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 transition-colors whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-muted-foreground',
        info: 'border-info/25 bg-info/10 text-info-strong',
        success: 'border-success/25 bg-success/10 text-success-strong',
        warning: 'border-warning/30 bg-warning/10 text-warning-strong',
        danger: 'border-danger/25 bg-danger/10 text-danger-strong',
        accent: 'border-accent/25 bg-accent/10 text-accent-strong',
        outline: 'border-border bg-transparent text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, tone, ...props }: BadgeProps): React.JSX.Element => (
  <span className={cn(badgeVariants({ tone }), className)} {...props} />
);

export { badgeVariants };
