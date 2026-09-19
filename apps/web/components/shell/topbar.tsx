'use client';

import type * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, Menu, Search, Workflow } from 'lucide-react';
import { Button, ScrollArea, Sheet, SheetContent, SheetTrigger, Separator } from '@engloop/ui';
import { findActiveItem } from '@/lib/navigation';
import { useUiStore } from '@/lib/ui-store';
import { SidebarNav } from './sidebar-nav';
import { NotificationMenu } from './notification-menu';
import { ThemeToggle } from './theme-toggle';
import { HealthIndicator } from './health-indicator';
import { notifyUnauthorized } from '@/lib/auth';

export const Topbar = (): React.JSX.Element => {
  const pathname = usePathname();
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNav = useUiStore((state) => state.setMobileNav);
  const setCommandPalette = useUiStore((state) => state.setCommandPalette);
  const active = findActiveItem(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNav}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation">
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0">
          <div className="flex h-14 items-center gap-2 border-b border-border px-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Workflow className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">EngLoop</span>
          </div>
          <ScrollArea className="h-[calc(100dvh-3.5rem)] scrollbar-thin">
            <SidebarNav onNavigate={() => setMobileNav(false)} />
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <Link href="/" className="flex items-center gap-2 md:hidden">
        <span className="text-sm font-semibold tracking-tight">EngLoop</span>
      </Link>

      <div className="hidden min-w-0 items-center gap-2 md:flex">
        <span className="truncate text-sm font-medium">{active?.label ?? 'Overview'}</span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="hidden h-8 gap-2 px-2.5 text-xs text-muted-foreground sm:flex"
          onClick={() => setCommandPalette(true)}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Search…</span>
          <kbd className="hidden rounded border border-border bg-muted px-1 font-mono text-[10px] lg:inline">
            ⌘K
          </kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="sm:hidden"
          aria-label="Search"
          onClick={() => setCommandPalette(true)}
        >
          <Search className="h-4 w-4" />
        </Button>

        <span className="md:hidden">
          <HealthIndicator />
        </span>
        <Separator orientation="vertical" className="mx-0.5 hidden h-5 sm:block" />
        <NotificationMenu />
        <ThemeToggle />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2"
          aria-label="Sign out"
          onClick={notifyUnauthorized}
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden lg:inline">Sign out</span>
        </Button>
      </div>
    </header>
  );
};
