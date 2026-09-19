'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Boxes, GitBranch, ListChecks, ShieldCheck } from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { PageHeader } from '@/components/common/page-header';
import { FilterBar } from '@/components/common/filter-bar';
import { EmptyState, QueryBoundary } from '@/components/common/states';
import { GitHubProjectActions } from '@/components/projects/github-project-actions';
import { titleCase } from '@/lib/format';
import { useProjects } from '@/lib/queries';

export default function ProjectsPage(): React.JSX.Element {
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const projects = useProjects({ search: search || undefined });

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project owns its repositories, its agent role assignments and its permission level."
        actions={<GitHubProjectActions />}
      />

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search projects' }}
        onReset={() => setSearch('')}
      />

      <QueryBoundary
        query={projects}
        entity="Projects"
        loadingLabel="Loading projects…"
        emptyCheck={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={Boxes}
            title="No projects yet"
            description="Create a project, then connect a local repository or import one from GitHub."
          />
        }
      >
        {(data) => (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((project) => (
              <Card
                key={project.id}
                className="cursor-pointer transition-colors hover:border-foreground/20"
                onClick={() => router.push(`/projects/${project.id}`)}
              >
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{project.name}</CardTitle>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {project.key}
                    </p>
                  </div>
                  <Badge tone={project.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {titleCase(project.status)}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {project.description ?? 'No description.'}
                  </p>

                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <ListChecks className="h-3 w-3" />
                      {project._count?.tasks ?? 0} tasks
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {project.repositories?.length ?? 0} repos
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      {project.permissionLevel.replace('LEVEL_', 'L').replace(/_/g, ' ')}
                    </span>
                  </div>

                  <Link
                    href={`/projects/${project.id}`}
                    className="inline-block text-xs text-info-strong hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    Open project →
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
