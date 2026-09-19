'use client';

import type * as React from 'react';
import type { TaskStatus } from '@engloop/types';
import { BOARD_COLUMNS } from '@engloop/workflow';
import { Badge, ScrollArea } from '@engloop/ui';
import { TaskCard } from './task-card';
import type { TaskSummary } from '@/lib/types';

/**
 * Kanban board. Column membership comes from @engloop/workflow so the board can
 * never disagree with the state machine about where a status belongs.
 */
export const TaskBoard = ({ tasks }: { tasks: TaskSummary[] }): React.JSX.Element => {
  const byColumn = new Map<string, TaskSummary[]>();
  for (const column of BOARD_COLUMNS) byColumn.set(column.id, []);
  for (const task of tasks) {
    const column = BOARD_COLUMNS.find((entry) =>
      (entry.statuses as readonly TaskStatus[]).includes(task.status),
    );
    byColumn.get(column?.id ?? 'backlog')?.push(task);
  }

  return (
    <ScrollArea className="w-full">
      <div className="flex min-w-full gap-3 overflow-x-auto pb-3 scrollbar-thin">
        {BOARD_COLUMNS.map((column) => {
          const items = byColumn.get(column.id) ?? [];
          return (
            <section
              key={column.id}
              className="flex w-[280px] shrink-0 flex-col rounded-lg border border-border bg-muted/40"
              aria-label={column.title}
            >
              <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <h2 className="text-xs font-semibold">{column.title}</h2>
                <Badge tone="outline">{items.length}</Badge>
              </header>
              <div className="flex flex-col gap-2 p-2">
                {items.length === 0 ? (
                  <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">Empty</p>
                ) : (
                  items.map((task) => <TaskCard key={task.id} task={task} />)
                )}
              </div>
            </section>
          );
        })}
      </div>
    </ScrollArea>
  );
};
