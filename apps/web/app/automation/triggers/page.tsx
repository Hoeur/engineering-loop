'use client';

import type * as React from 'react';
import { Zap } from 'lucide-react';
import { DomainEventName } from '@engloop/types';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';

/**
 * The event catalogue is the trigger surface: anything that can start work in
 * EngLoop is one of these domain events. Rule-based triggers are the next step
 * on the roadmap; the events themselves are already emitted.
 */
export default function TriggersPage(): React.JSX.Element {
  const events = Object.values(DomainEventName);
  const groups = new Map<string, string[]>();
  for (const event of events) {
    const [group = 'other'] = event.split('.');
    groups.set(group, [...(groups.get(group) ?? []), event]);
  }

  return (
    <>
      <PageHeader
        title="Triggers"
        description="Every internal domain event EngLoop emits. Schedules and API calls start work today; rule-based triggers on these events are the next increment."
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-info/25 bg-info/5 px-3 py-2.5 text-xs text-info-strong">
        <Zap className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Events are published through a typed in-process bus. The publish signature already carries
          everything a durable transport needs, so moving to Redis streams or NATS is a one-file
          change.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...groups.entries()].map(([group, names]) => (
          <Card key={group}>
            <CardHeader>
              <CardTitle className="capitalize">{group.replace(/_/g, ' ')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-1">
                {names.map((name) => (
                  <li key={name}>
                    <Badge tone="outline">
                      <span className="font-mono text-[10px]">{name}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
