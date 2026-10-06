'use client';

import * as React from 'react';
import Link from 'next/link';
import { OrgRole, type ProjectPhaseSummary } from '@engloop/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { EmptyState, ErrorState, QueryBoundary } from '@/components/common/states';
import { useBoard, useCurrentUser } from '@/lib/queries';
import {
  usePhaseChange,
  usePhaseDetail,
  useProjectPhases,
  type PhaseChange,
} from '@/lib/project-phases';
import type { TaskSummary } from '@/lib/types';
import { PhasePlanningForm } from './phase-planning-form';
import { PlanningList } from './planning-fields';

interface PhaseCardProps {
  projectId: string;
  phase: ProjectPhaseSummary;
  phases: ProjectPhaseSummary[];
  index: number;
  count: number;
  canManage: boolean;
  pending: boolean;
  tasks: TaskSummary[];
  tasksReady: boolean;
  change: (change: PhaseChange) => void;
  edit: () => void;
  move: (offset: number) => void;
}

const PhaseCard = ({
  projectId,
  phase,
  phases,
  index,
  count,
  canManage,
  pending,
  tasks,
  tasksReady,
  change,
  edit,
  move,
}: PhaseCardProps): React.JSX.Element => {
  const detail = usePhaseDetail(projectId, phase.id);
  const [taskId, setTaskId] = React.useState('');
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const assigned = new Set(detail.data?.tasks.map((task) => task.id));
  const candidates = tasks.filter((task) => !assigned.has(task.id));
  return (
    <Card className="min-w-0">
      <CardHeader>
        <Badge tone="outline" className="w-fit">
          Draft
        </Badge>
        <CardTitle className="break-words">
          {index + 1}. {phase.name}
        </CardTitle>
        <p className="break-words text-xs text-muted-foreground">
          {phase.description ?? 'No description.'}
        </p>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending || index === 0}
              onClick={() => move(-1)}
              aria-label={`Move ${phase.name} up`}
            >
              Move up
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || index === count - 1}
              onClick={() => move(1)}
              aria-label={`Move ${phase.name} down`}
            >
              Move down
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={edit}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          </div>
        ) : null}
        {confirmDelete ? (
          <div className="space-y-2 text-xs">
            <p>Delete {phase.name}? Its tasks will remain in the project and become unassigned.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={pending}
                onClick={() => change({ kind: 'delete', phaseId: phase.id })}
              >
                Confirm delete
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setConfirmDelete(false)}
              >
                Keep phase
              </Button>
            </div>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1 text-xs">
          <h4 className="font-medium">Phase objective</h4>
          <p className="break-words">{phase.objective ?? 'No objective specified.'}</p>
        </div>
        <PlanningList title="Deliverables" items={phase.deliverables ?? []} />
        <PlanningList title="Phase acceptance criteria" items={phase.acceptanceCriteria ?? []} />
        <PlanningList title="Required roles" items={phase.requiredRoles ?? []} />
        <PlanningList
          title="Phase dependencies"
          items={(phase.dependencyIds ?? []).map(
            (id) => phases.find((item) => item.id === id)?.name ?? 'Unavailable phase',
          )}
        />
        <QueryBoundary query={detail} entity="Phase" loadingLabel="Loading phase tasks…">
          {(data) =>
            data.tasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No tasks linked.</p>
            ) : (
              <ul className="space-y-2">
                {data.tasks.map((task) => (
                  <li key={task.id} className="flex min-w-0 flex-wrap items-center gap-2">
                    <Link
                      className="min-w-0 flex-1 break-words text-xs underline"
                      href={`/engineering/tasks/${task.id}`}
                    >
                      {task.key} · {task.title}
                    </Link>
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        aria-label={`Unlink ${task.key}`}
                        onClick={() =>
                          change({ kind: 'unlink', phaseId: phase.id, taskId: task.id })
                        }
                      >
                        Unlink
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          }
        </QueryBoundary>
        {canManage ? (
          <div className="space-y-2">
            <label htmlFor={`phase-task-${phase.id}`} className="block text-xs">
              Link or move an existing project task
            </label>
            <select
              id={`phase-task-${phase.id}`}
              className="h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-xs"
              value={taskId}
              disabled={pending || !tasksReady || detail.isLoading || detail.isError}
              onChange={(event) => setTaskId(event.target.value)}
            >
              <option value="">Choose a task</option>
              {candidates.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.key} · {task.title}
                  {task.phaseId ? ' (move from another phase)' : ''}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={
                pending ||
                !tasksReady ||
                detail.isLoading ||
                detail.isError ||
                !candidates.some((task) => task.id === taskId)
              }
              onClick={() => change({ kind: 'link', phaseId: phase.id, taskId })}
            >
              Link task
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export const ProjectPhases = ({ projectId }: { projectId: string }): React.JSX.Element => {
  const phases = useProjectPhases(projectId);
  const user = useCurrentUser();
  const board = useBoard(projectId);
  const mutation = usePhaseChange(projectId);
  const canManage = user.data?.role === OrgRole.OWNER || user.data?.role === OrgRole.ADMIN;
  const [editing, setEditing] = React.useState<ProjectPhaseSummary | null>(null);
  const [formVersion, setFormVersion] = React.useState(0);
  const resetForm = (): void => {
    setEditing(null);
    setFormVersion((value) => value + 1);
  };
  const change = (input: PhaseChange): void => {
    mutation.reset();
    mutation.mutate(input);
  };
  const move = (index: number, offset: number): void => {
    const ids = phases.data?.items.map((phase) => phase.id) ?? [];
    const other = index + offset;
    if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other]!, ids[index]!];
    change({ kind: 'order', phaseIds: ids });
  };
  return (
    <section className="mt-6 min-w-0 space-y-3" aria-label="Project phases">
      <h2 className="text-sm font-semibold">Project phases</h2>
      <p className="text-xs text-muted-foreground">
        Draft planning only. Ordering and task links do not activate phases or schedule work.
      </p>
      {user.isError ? (
        <ErrorState error={user.error} onRetry={() => void user.refetch()} entity="Current user" />
      ) : null}
      {canManage ? (
        <PhasePlanningForm
          key={`${editing?.id ?? 'create'}-${formVersion}`}
          phase={editing}
          phases={phases.data?.items ?? []}
          pending={mutation.isPending}
          disabled={phases.isLoading || phases.isError}
          cancel={resetForm}
          save={(fields) => {
            mutation.reset();
            mutation.mutate(
              editing
                ? { kind: 'update', phaseId: editing.id, fields }
                : { kind: 'create', fields },
              { onSuccess: resetForm },
            );
          }}
        />
      ) : null}
      {mutation.isPending ? (
        <p role="status" className="text-xs text-muted-foreground">
          Saving phase changes…
        </p>
      ) : null}
      {mutation.isError ? (
        <p role="alert" className="break-words text-xs text-danger">
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Could not save phase changes.'}
        </p>
      ) : null}
      {canManage && board.isError ? (
        <ErrorState
          error={board.error}
          onRetry={() => void board.refetch()}
          entity="Project tasks"
        />
      ) : null}
      {canManage && board.isLoading ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading available project tasks…
        </p>
      ) : null}
      <QueryBoundary
        query={phases}
        entity="Phases"
        loadingLabel="Loading project phases…"
        emptyCheck={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No phases yet"
            description="Add a draft phase, then link existing project tasks."
          />
        }
      >
        {(data) => (
          <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.items.map((phase, index) => (
              <PhaseCard
                key={phase.id}
                projectId={projectId}
                phase={phase}
                phases={data.items}
                index={index}
                count={data.items.length}
                canManage={canManage}
                pending={mutation.isPending}
                tasks={board.data?.items ?? []}
                tasksReady={Boolean(board.data) && !board.isError}
                change={change}
                move={(offset) => move(index, offset)}
                edit={() => {
                  mutation.reset();
                  setEditing(phase);
                  setFormVersion((value) => value + 1);
                }}
              />
            ))}
          </div>
        )}
      </QueryBoundary>
    </section>
  );
};
