'use client';

import type * as React from 'react';
import Link from 'next/link';
import { Bell, CheckCheck } from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ScrollArea,
} from '@engloop/ui';
import { relativeTime } from '@/lib/format';
import { SEVERITY_TONE } from '@/lib/status';
import { useMarkNotificationsRead, useNotifications } from '@/lib/queries';

export const NotificationMenu = (): React.JSX.Element => {
  const { data, isLoading } = useNotifications();
  const markRead = useMarkNotificationsRead();

  const notifications = data?.items ?? [];
  const unread = (data?.meta as { unread?: number } | undefined)?.unread ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-danger-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(360px,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="px-0 py-0">Notifications</DropdownMenuLabel>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => markRead.mutate(undefined)}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator className="m-0" />

        <ScrollArea className="max-h-[320px]">
          {isLoading ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</p>
          ) : notifications.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Nothing needs your attention.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((notification) => {
                const taskId = (notification.payload as { taskId?: string }).taskId;
                const inner = (
                  <div className="space-y-1 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium leading-snug">{notification.title}</p>
                      <Badge tone={SEVERITY_TONE[notification.severity]}>
                        {notification.severity.toLowerCase()}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{notification.body}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {relativeTime(notification.createdAt)}
                      {notification.readAt ? '' : ' · unread'}
                    </p>
                  </div>
                );
                return (
                  <li
                    key={notification.id}
                    className={notification.readAt ? 'opacity-70' : undefined}
                  >
                    {taskId ? (
                      <Link
                        href={`/engineering/tasks/${taskId}`}
                        className="block hover:bg-muted/60"
                        onClick={() => markRead.mutate(notification.id)}
                      >
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>

        <DropdownMenuSeparator className="m-0" />
        <Link
          href="/settings/notifications"
          className="block px-3 py-2 text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Notification centre
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
