'use client';

import * as React from 'react';
import { CheckType, Priority, RiskLevel, TaskStatus, TaskType } from '@engloop/types';
import { updateTaskSchema } from '@engloop/schemas';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@engloop/ui';
import { useTask } from '@/lib/queries';
import { useEditTask } from '@/lib/task-editing';
import type { TaskDetail } from '@/lib/types';

const idle: readonly TaskStatus[] = [
  TaskStatus.BACKLOG,
  TaskStatus.PLAN_READY,
  TaskStatus.BLOCKED,
  TaskStatus.FAILED,
];

interface Draft {
  title: string;
  objective: string;
  description: string;
  type: TaskType;
  priority: Priority;
  riskLevel: RiskLevel;
  acceptanceCriteria: string;
  implementationNotes: string;
  suggestedFiles: string;
  requiredChecks: CheckType[];
  maxAttempts: string;
}
const draftFrom = (task: TaskDetail): Draft => ({
  title: task.title,
  objective: task.objective,
  description: task.description,
  type: task.type,
  priority: task.priority,
  riskLevel: task.riskLevel,
  acceptanceCriteria: task.acceptanceCriteria.join('\n'),
  implementationNotes: task.implementationNotes.join('\n'),
  suggestedFiles: task.suggestedFiles.join('\n'),
  requiredChecks: [...task.requiredChecks],
  maxAttempts: String(task.maxAttempts),
});
const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

export const TaskEditDialog = ({ task }: { task: TaskDetail }): React.JSX.Element => {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Edit task
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? <TaskEditForm key={task.id} task={task} close={() => setOpen(false)} /> : null}
      </Dialog>
    </>
  );
};

const TaskEditForm = ({
  task,
  close,
}: {
  task: TaskDetail;
  close: () => void;
}): React.JSX.Element => {
  const query = useTask(task.id);
  const edit = useEditTask(task.id);
  // Polling may refresh the page while a draft is open; retain its original baseline.
  const [baseline, setBaseline] = React.useState(task);
  const [draft, setDraft] = React.useState(() => draftFrom(task));
  const [error, setError] = React.useState<string | null>(null);
  const [reloading, setReloading] = React.useState(false);
  const submitting = React.useRef(false);
  const busy = edit.isPending || reloading;
  const latest = query.data ?? task;
  const locked =
    !idle.includes(latest.status) ||
    latest.workflowRuns.some((run) =>
      ['PENDING', 'RUNNING', 'WAITING_FOR_HUMAN'].includes(run.status),
    ) ||
    latest.agentRuns.some(
      (run) => run.role !== 'PLANNER' || ['PENDING', 'RUNNING'].includes(run.status),
    ) ||
    Boolean(
      latest.testRuns.length ||
        latest.reviewRuns.length ||
        latest.commits.length ||
        latest.pullRequests.length ||
        latest.subtasks.length,
    );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const reload = async () => {
    if (busy) return;
    setReloading(true);
    try {
      const result = await query.refetch({ throwOnError: true });
      if (result.data) {
        setBaseline(result.data);
        setDraft(draftFrom(result.data));
        setError(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reload task');
    } finally {
      setReloading(false);
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || busy || locked) return;
    setError(null);
    const values = {
      ...draft,
      title: draft.title.trim(),
      maxAttempts: Number(draft.maxAttempts),
      acceptanceCriteria: lines(draft.acceptanceCriteria),
      implementationNotes: lines(draft.implementationNotes),
      suggestedFiles: lines(draft.suggestedFiles),
    };
    const changes = Object.fromEntries(
      Object.entries(values).filter(
        ([key, value]) =>
          JSON.stringify(value) !== JSON.stringify(baseline[key as keyof TaskDetail]),
      ),
    );
    if (!Object.keys(changes).length) {
      setError('No changes to save.');
      return;
    }
    const parsed = updateTaskSchema.safeParse({
      ...changes,
      expectedUpdatedAt: baseline.updatedAt,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
      return;
    }
    submitting.current = true;
    try {
      await edit.mutateAsync(parsed.data);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save task');
    } finally {
      submitting.current = false;
    }
  };
  const textField = (
    key:
      | 'title'
      | 'objective'
      | 'description'
      | 'acceptanceCriteria'
      | 'implementationNotes'
      | 'suggestedFiles',
    label: string,
    maxLength?: number,
  ) => (
    <div className="space-y-1.5" key={key}>
      <Label htmlFor={`edit-task-${key}`}>{label}</Label>
      {key === 'title' || key === 'objective' ? (
        <Input
          id={`edit-task-${key}`}
          value={draft[key]}
          maxLength={maxLength}
          onChange={(event) => set(key, event.target.value)}
        />
      ) : (
        <Textarea
          id={`edit-task-${key}`}
          rows={3}
          value={draft[key]}
          maxLength={maxLength}
          onChange={(event) => set(key, event.target.value)}
        />
      )}
    </div>
  );
  return (
    <DialogContent
      className="max-w-2xl"
      hideClose={busy}
      onInteractOutside={(event) => {
        if (busy) event.preventDefault();
      }}
      onEscapeKeyDown={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit task</DialogTitle>
        <DialogDescription>
          Edit idle planning inputs. Saving clears the current plan; historical runs remain
          available.
        </DialogDescription>
      </DialogHeader>
      <form className="min-w-0 space-y-4" onSubmit={(event) => void submit(event)} noValidate>
        {locked ? (
          <p role="status" className="text-sm text-muted-foreground">
            This task is locked for editing. Finish or cancel active work; use a follow-up task for
            changes to executed work or planned children.
          </p>
        ) : null}
        <fieldset
          disabled={busy || locked}
          className="m-0 max-h-[55vh] min-w-0 space-y-3 overflow-y-auto border-0 p-0 pr-1 disabled:opacity-70"
        >
          {textField('title', 'Title', 200)}
          {textField('objective', 'Objective', 4000)}
          {textField('description', 'Description', 20000)}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['type', 'Type', Object.values(TaskType)],
                ['priority', 'Priority', Object.values(Priority)],
                ['riskLevel', 'Risk', Object.values(RiskLevel)],
              ] as const
            ).map(([key, label, options]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`edit-task-${key}`}>{label}</Label>
                <select
                  id={`edit-task-${key}`}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                  value={draft[key]}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [key]: event.target.value }))
                  }
                >
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="edit-task-attempts">Max attempts</Label>
              <Input
                id="edit-task-attempts"
                type="number"
                min={1}
                max={10}
                value={draft.maxAttempts}
                onChange={(event) => set('maxAttempts', event.target.value)}
              />
            </div>
          </div>
          {textField('acceptanceCriteria', 'Acceptance criteria (one per line)')}
          {textField('implementationNotes', 'Implementation notes (one per line)')}
          {textField('suggestedFiles', 'Suggested files (one per line)')}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">Required checks</legend>
            <div className="flex flex-wrap gap-3">
              {Object.values(CheckType).map((check) => (
                <label key={check} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={draft.requiredChecks.includes(check)}
                    onChange={(event) =>
                      set(
                        'requiredChecks',
                        event.target.checked
                          ? [...draft.requiredChecks, check]
                          : draft.requiredChecks.filter((value) => value !== check),
                      )
                    }
                  />
                  {check}
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>
        {error ? (
          <p role="alert" className="break-words text-sm text-danger-strong">
            {error}
          </p>
        ) : null}
        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void reload()}>
            Reload saved task
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || locked}>
            {edit.isPending ? 'Saving…' : 'Save task'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
};
