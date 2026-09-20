'use client';

import type * as React from 'react';
import Link from 'next/link';
import { Bell, GitBranch, History, ShieldCheck, Terminal } from 'lucide-react';
import { PERMISSION_LEVEL_ORDER } from '@engloop/types';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { QueryBoundary } from '@/components/common/states';
import { useHealth, useProjects, useWorktrees } from '@/lib/queries';

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  LEVEL_0_OBSERVE: 'Agents may inspect the repository only.',
  LEVEL_1_PLAN: 'Agents may inspect and produce plans and TODOs.',
  LEVEL_2_CODE: 'Agents may modify code inside isolated worktrees.',
  LEVEL_3_PR: 'Agents may commit, push and open pull requests.',
  LEVEL_4_MERGE: 'Agents may merge approved pull requests.',
  LEVEL_5_DEPLOY: 'Agents may trigger deployments (not implemented in the MVP).',
};

export default function SettingsPage(): React.JSX.Element {
  const projects = useProjects();
  const worktrees = useWorktrees();
  const health = useHealth();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Permission levels, workspace isolation and platform health."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Permission levels
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {PERMISSION_LEVEL_ORDER.map((level, index) => (
              <div key={level} className="flex items-start gap-2 text-xs">
                <Badge tone={index >= 4 ? 'danger' : index >= 3 ? 'warning' : 'info'}>
                  L{index}
                </Badge>
                <div className="min-w-0">
                  <p className="font-medium">{level.replace(/_/g, ' ')}</p>
                  <p className="text-muted-foreground">{PERMISSION_DESCRIPTIONS[level]}</p>
                </div>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-muted-foreground">
              New projects default to LEVEL_3_PR. Automatic production deployment is intentionally
              not implemented.
            </p>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Project permissions</CardTitle>
          </CardHeader>
          <CardContent>
            <QueryBoundary query={projects} loadingLabel="Loading projects…">
              {(data) => (
                <ul className="divide-y divide-border">
                  {data.items.map((project) => (
                    <li key={project.id} className="flex items-center justify-between gap-2 py-2">
                      <Link
                        href={`/projects/${project.id}`}
                        className="truncate text-xs hover:underline"
                      >
                        {project.name}
                      </Link>
                      <Badge tone="outline" className="shrink-0">
                        {project.permissionLevel.replace(/_/g, ' ')}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </QueryBoundary>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5" /> Agent worktrees
            </CardTitle>
          </CardHeader>
          <CardContent>
            <QueryBoundary query={worktrees} loadingLabel="Loading worktrees…">
              {(data) =>
                data.items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No worktrees provisioned.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.items.map((worktree) => (
                      <li key={worktree.id} className="py-2">
                        <p className="truncate font-mono text-[11px]">{worktree.path}</p>
                        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="truncate">{worktree.branch}</span>
                          <Badge tone={worktree.clean ? 'success' : 'warning'} className="shrink-0">
                            {worktree.clean ? 'clean' : 'dirty'}
                          </Badge>
                        </p>
                      </li>
                    ))}
                  </ul>
                )
              }
            </QueryBoundary>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Agents only ever receive a worktree path. The shared checkout under
              <code className="mx-1 font-mono">workspace/repositories/</code> is never handed out.
            </p>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5" /> Platform health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <QueryBoundary query={health} loadingLabel="Checking health…">
              {(data) => (
                <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] scrollbar-thin">
                  {JSON.stringify(data, null, 2)}
                </pre>
              )}
            </QueryBoundary>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/settings/audit"
          className="inline-flex items-center gap-1.5 text-xs text-info-strong hover:underline"
        >
          <History className="h-3.5 w-3.5" /> Audit log
        </Link>
        <Link
          href="/settings/notifications"
          className="inline-flex items-center gap-1.5 text-xs text-info-strong hover:underline"
        >
          <Bell className="h-3.5 w-3.5" /> Notification centre
        </Link>
      </div>
    </>
  );
}
