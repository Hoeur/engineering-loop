'use client';

import type * as React from 'react';
import Link from 'next/link';
import { PanelLeftClose, PanelLeftOpen, Workflow } from 'lucide-react';
import { Button, ScrollArea, Separator, cn } from '@engloop/ui';
import { useUiStore } from '@/lib/ui-store';
import { SidebarNav } from './sidebar-nav';
import { HealthIndicator } from './health-indicator';

export const Sidebar = (): React.JSX.Element => {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggle = useUiStore((state) => state.toggleSidebar);

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 md:flex',
        collapsed ? 'w-[60px]' : 'w-[232px]',
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center gap-2 border-b border-border px-3',
          collapsed && 'justify-center px-0',
        )}
      >
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Workflow className="h-4 w-4" />
          </span>
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-tight">EngLoop</span>
          )}
        </Link>
      </div>

      <ScrollArea className="flex-1 scrollbar-thin">
        <SidebarNav collapsed={collapsed} />
      </ScrollArea>

      <Separator />
      <div
        className={cn('flex items-center gap-2 p-2', collapsed ? 'flex-col' : 'justify-between')}
      >
        {!collapsed && <HealthIndicator />}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </div>
    </aside>
  );
};
