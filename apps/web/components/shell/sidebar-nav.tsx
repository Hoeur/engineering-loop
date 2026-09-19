'use client';

import type * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip, TooltipContent, TooltipTrigger, cn } from '@engloop/ui';
import { NAVIGATION } from '@/lib/navigation';

export const SidebarNav = ({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}): React.JSX.Element => {
  const pathname = usePathname();

  const isActive = (href: string): boolean =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="flex flex-col gap-4 px-2 py-3" aria-label="Main">
      {NAVIGATION.map((section, index) => (
        <div key={section.label ?? `section-${String(index)}`} className="space-y-0.5">
          {section.label && !collapsed ? (
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {section.label}
            </p>
          ) : null}
          {section.items.map((item) => {
            const active = isActive(item.href);
            const link = (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  collapsed && 'justify-center px-0',
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );

            return collapsed ? (
              <Tooltip key={item.href} delayDuration={0}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              link
            );
          })}
        </div>
      ))}
    </nav>
  );
};
