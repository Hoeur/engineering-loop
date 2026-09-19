'use client';

import type * as React from 'react';
import Link from 'next/link';
import { Bell, CheckCheck } from 'lucide-react';
import { Badge, Button, Card, CardContent } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { relativeTime, titleCase } from '@/lib/format';
import { SEVERITY_TONE } from '@/lib/status';
import { useMarkNotificationsRead, useNotifications } from '@/lib/queries';

export default function NotificationCentrePage(): React.JSX.Element {
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();

  return (
    <>
      <PageHeader
        title="Notification centre"
        description="In-app notifications. Email and Slack channels have a provider interface but are not wired in the MVP."
        actions={
          <Button size="sm" variant="outline" onClick={() => markRead.mutate(undefined)}>
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </Button>
        }
      />

      <QueryBoundary
        query={notifications}
        entity="Notifications"
        loadingLabel="Loading notifications…"
        emptyCheck={(data) => data.items.length === 0}
        empty={<EmptyState icon={Bell} title="Nothing needs your attention" />}
      >
        {(data) => (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {data.items.map((notification) => {
                  const taskId = (notification.payload as { taskId?: string }).taskId;
                  const inner = (
                    <div className="space-y-1 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{notification.title}</p>
                        <div className="flex items-center gap-1.5">
                          <Badge tone="outline">{titleCase(notification.type)}</Badge>
                          <Badge tone={SEVERITY_TONE[notification.severity]}>
                            {titleCase(notification.severity)}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{notification.body}</p>
                      <p className="text-[11px] text-muted-foreground">
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
                          className="block hover:bg-muted/40"
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
            </CardContent>
          </Card>
        )}
      </QueryBoundary>
    </>
  );
}
