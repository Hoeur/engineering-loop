'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Plus } from 'lucide-react';
import { ApiErrorCode, CheckType, Priority, RiskLevel, TaskType } from '@engloop/types';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@engloop/ui';
import { ApiError } from '@/lib/api-client';
import { titleCase } from '@/lib/format';
import { useCreateTask, useRunTask } from '@/lib/queries';
import type { CreateTaskInput, RepositorySummary, TaskSummary } from '@/lib/types';

/** Checks a task can require; with none selected EngLoop runs its default set. */
const CHECK_OPTIONS: CheckType[] = [
  CheckType.LINT,
  CheckType.TYPECHECK,
  CheckType.UNIT,
  CheckType.INTEGRATION,
  CheckType.BUILD,
  CheckType.E2E,
  CheckType.SECURITY,
];

const LABELS: Partial<Record<string, string>> = {
  UI: 'UI',
  DEVOPS: 'DevOps',
  E2E: 'E2E',
  UNIT: 'Unit tests',
};
const optionLabel = (value: string): string => LABELS[value] ?? titleCase(value);

export interface NewTaskForm {
  repositoryId: string;
  title: string;
  objective: string;
  description: string;
  type: TaskType;
  priority: Priority;
  riskLevel: RiskLevel;
  acceptanceCriteria: string;
  requiredChecks: CheckType[];
  maxAttempts: string;
}

export const emptyNewTaskForm = (repositories: RepositorySummary[]): NewTaskForm => ({
  repositoryId: repositories[0]?.id ?? '',
  title: '',
  objective: '',
  description: '',
  type: TaskType.FEATURE,
  priority: Priority.MEDIUM,
  riskLevel: RiskLevel.MEDIUM,
  acceptanceCriteria: '',
  requiredChecks: [],
  maxAttempts: '3',
});

/** Mirrors the API's `createTaskSchema` limits so mistakes show before a round trip. */
export const validateNewTask = (form: NewTaskForm): string | null => {
  const title = form.title.trim();
  if (title.length < 3) return 'Give the task a title of at least 3 characters.';
  if (title.length > 200) return 'Keep the title under 200 characters.';
  const attempts = Number(form.maxAttempts);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    return 'Max attempts must be a whole number from 1 to 10.';
  }
  return null;
};

/** One acceptance criterion per non-empty line. */
export const toLines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

export const buildCreateTaskInput = (projectId: string, form: NewTaskForm): CreateTaskInput => ({
  projectId,
  ...(form.repositoryId ? { repositoryId: form.repositoryId } : {}),
  title: form.title.trim(),
  objective: form.objective.trim(),
  description: form.description.trim(),
  type: form.type,
  priority: form.priority,
  riskLevel: form.riskLevel,
  acceptanceCriteria: toLines(form.acceptanceCriteria),
  requiredChecks: form.requiredChecks,
  maxAttempts: Number(form.maxAttempts),
});

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof ApiError || error instanceof Error ? error.message : fallback;

export const isDefinitiveCreateFailure = (error: unknown): boolean =>
  error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408;

interface EnumSelectProps<T extends string> {
  id: string;
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}

const EnumSelect = <T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: EnumSelectProps<T>): React.JSX.Element => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger id={id} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {optionLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

export interface NewTaskDialogProps {
  projectId: string;
  repositories: RepositorySummary[];
}

export const NewTaskDialog = ({
  projectId,
  repositories,
}: NewTaskDialogProps): React.JSX.Element => {
  const router = useRouter();
  const createTask = useCreateTask();
  const runTask = useRunTask();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<NewTaskForm>(() => emptyNewTaskForm(repositories));
  const [validation, setValidation] = React.useState<string | null>(null);
  const [createdTask, setCreatedTask] = React.useState<TaskSummary | null>(null);
  const [startError, setStartError] = React.useState<string | null>(null);
  const [ambiguousCreateFailure, setAmbiguousCreateFailure] = React.useState(false);
  const submitLockedRef = React.useRef(false);
  const startLockedRef = React.useRef(false);
  const createAttemptRef = React.useRef<{
    idempotencyKey: string;
    body: CreateTaskInput;
  } | null>(null);

  const resetDialog = (): void => {
    submitLockedRef.current = false;
    startLockedRef.current = false;
    createAttemptRef.current = null;
    setCreatedTask(null);
    setStartError(null);
    setAmbiguousCreateFailure(false);
    setValidation(null);
    setForm(emptyNewTaskForm(repositories));
  };

  const openCreatedTask = (task: TaskSummary): void => {
    setOpen(false);
    resetDialog();
    router.push(`/engineering/tasks/${task.id}`);
  };

  const update = <K extends keyof NewTaskForm>(key: K, value: NewTaskForm[K]): void => {
    if (ambiguousCreateFailure) return;
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleCheck = (check: CheckType): void => {
    if (ambiguousCreateFailure) return;
    setForm((current) => ({
      ...current,
      requiredChecks: current.requiredChecks.includes(check)
        ? current.requiredChecks.filter((entry) => entry !== check)
        : [...current.requiredChecks, check],
    }));
  };

  const discardCreateAttempt = (): void => {
    if (submitLockedRef.current || createTask.isPending) return;
    createAttemptRef.current = null;
    submitLockedRef.current = false;
    setAmbiguousCreateFailure(false);
    setValidation(null);
    createTask.reset();
  };

  const startWorkflow = (task: TaskSummary): void => {
    if (startLockedRef.current) return;
    startLockedRef.current = true;
    setStartError(null);
    runTask.mutate(
      {
        taskId: task.id,
        workflowKey: 'engineering-task',
        skipPlanning: false,
        force: false,
      },
      {
        onSuccess: (run) => {
          setOpen(false);
          resetDialog();
          router.push(`/engineering/runs/${run.id}`);
        },
        onError: (error) => {
          startLockedRef.current = false;
          const existingRunId =
            error instanceof ApiError && error.code === ApiErrorCode.TASK_ALREADY_RUNNING
              ? error.details?.['workflowRunId']
              : null;
          if (typeof existingRunId === 'string' && existingRunId.length > 0) {
            setOpen(false);
            resetDialog();
            router.push(`/engineering/runs/${existingRunId}`);
            return;
          }
          setStartError(errorMessage(error, 'Could not start the workflow'));
        },
      },
    );
  };

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitLockedRef.current || createdTask) return;
    let attempt = createAttemptRef.current;
    if (!attempt) {
      const problem = validateNewTask(form);
      setValidation(problem);
      if (problem) return;
      attempt = {
        idempotencyKey: crypto.randomUUID(),
        body: buildCreateTaskInput(projectId, form),
      };
      createAttemptRef.current = attempt;
      setAmbiguousCreateFailure(false);
    }
    submitLockedRef.current = true;
    createTask.mutate(attempt, {
      onSuccess: (task) => {
        submitLockedRef.current = false;
        createAttemptRef.current = null;
        setAmbiguousCreateFailure(false);
        setCreatedTask(task);
        startWorkflow(task);
      },
      onError: (error) => {
        submitLockedRef.current = false;
        if (isDefinitiveCreateFailure(error)) {
          createAttemptRef.current = null;
          setAmbiguousCreateFailure(false);
          return;
        }
        setAmbiguousCreateFailure(true);
      },
    });
  };

  const repositoryName = repositories.find((entry) => entry.id === form.repositoryId)?.name;
  const isPending = createTask.isPending || runTask.isPending;

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      setOpen(true);
      return;
    }
    if (ambiguousCreateFailure || isPending || submitLockedRef.current || startLockedRef.current) {
      return;
    }
    setOpen(false);
    resetDialog();
  };

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus /> New task
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl" hideClose={ambiguousCreateFailure}>
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>
              Describe the change. EngLoop creates the task, starts the full workflow with planning,
              and opens the live run.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={submit} noValidate>
            {createdTask && startError ? (
              <div
                role="alert"
                className="space-y-3 rounded-md border border-danger/25 bg-danger/5 p-4"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      Task created, but the workflow did not start.
                    </p>
                    <p className="text-sm text-muted-foreground">{startError}</p>
                    <p className="text-xs text-muted-foreground">
                      Retry starting this task or open it to inspect and start it manually. EngLoop
                      will not create another task.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <fieldset
                disabled={ambiguousCreateFailure}
                className="m-0 max-h-[60vh] space-y-4 overflow-y-auto border-0 p-0 pr-1 disabled:opacity-70"
              >
                {repositories.length > 1 ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="new-task-repository">Repository</Label>
                    <Select
                      value={form.repositoryId}
                      onValueChange={(value) => update('repositoryId', value)}
                    >
                      <SelectTrigger id="new-task-repository" aria-label="Repository">
                        <SelectValue placeholder="Choose a repository" />
                      </SelectTrigger>
                      <SelectContent>
                        {repositories.map((repository) => (
                          <SelectItem key={repository.id} value={repository.id}>
                            {repository.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {repositoryName
                      ? `Repository: ${repositoryName}`
                      : 'No repository is connected, so agents will have no code to work on.'}
                  </p>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="new-task-title">Title</Label>
                  <Input
                    id="new-task-title"
                    value={form.title}
                    maxLength={200}
                    placeholder="Health check: make lint and typecheck pass on main"
                    onChange={(event) => update('title', event.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="new-task-objective">Objective</Label>
                  <Input
                    id="new-task-objective"
                    value={form.objective}
                    maxLength={4000}
                    placeholder="The outcome in one sentence"
                    onChange={(event) => update('objective', event.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="new-task-description">Description</Label>
                  <Textarea
                    id="new-task-description"
                    rows={5}
                    value={form.description}
                    maxLength={20000}
                    placeholder="What to do, what to leave alone, anything the agents should know"
                    onChange={(event) => update('description', event.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <EnumSelect
                    id="new-task-type"
                    label="Type"
                    value={form.type}
                    options={Object.values(TaskType)}
                    onChange={(value) => update('type', value)}
                  />
                  <EnumSelect
                    id="new-task-priority"
                    label="Priority"
                    value={form.priority}
                    options={Object.values(Priority)}
                    onChange={(value) => update('priority', value)}
                  />
                  <EnumSelect
                    id="new-task-risk"
                    label="Risk"
                    value={form.riskLevel}
                    options={Object.values(RiskLevel)}
                    onChange={(value) => update('riskLevel', value)}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="new-task-attempts">Max attempts</Label>
                    <Input
                      id="new-task-attempts"
                      type="number"
                      min={1}
                      max={10}
                      value={form.maxAttempts}
                      onChange={(event) => update('maxAttempts', event.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="new-task-criteria">Acceptance criteria</Label>
                  <Textarea
                    id="new-task-criteria"
                    rows={4}
                    value={form.acceptanceCriteria}
                    placeholder={'One per line, e.g.\n`npm run lint` exits 0'}
                    onChange={(event) => update('acceptanceCriteria', event.target.value)}
                  />
                </div>

                <fieldset className="space-y-1.5">
                  <legend className="text-xs font-medium">Required checks</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {CHECK_OPTIONS.map((check) => (
                      <label key={check} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={form.requiredChecks.includes(check)}
                          onChange={() => toggleCheck(check)}
                        />
                        {optionLabel(check)}
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    None selected: EngLoop runs its default checks.
                  </p>
                </fieldset>
              </fieldset>
            )}

            {!createdTask && validation ? (
              <p role="alert" className="text-sm text-danger">
                {validation}
              </p>
            ) : null}
            {!createdTask && ambiguousCreateFailure ? (
              <div role="alert" className="space-y-1 text-sm text-danger">
                <p>The task creation outcome is unknown.</p>
                <p className="text-xs text-muted-foreground">
                  The original form is frozen. Retry the exact same request, or discard it before
                  editing.
                </p>
              </div>
            ) : null}
            {!createdTask && createTask.isError && !ambiguousCreateFailure ? (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(createTask.error, 'Could not create the task')}
              </p>
            ) : null}

            <DialogFooter>
              {createdTask && startError ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={runTask.isPending}
                    onClick={() => openCreatedTask(createdTask)}
                  >
                    Open created task
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={runTask.isPending}
                    onClick={() => startWorkflow(createdTask)}
                  >
                    {runTask.isPending ? <Loader2 className="animate-spin" /> : null}
                    Retry workflow start
                  </Button>
                </>
              ) : (
                <>
                  {!ambiguousCreateFailure ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleOpenChange(false)}
                    >
                      Cancel
                    </Button>
                  ) : null}
                  {ambiguousCreateFailure ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={discardCreateAttempt}
                    >
                      Discard and edit
                    </Button>
                  ) : null}
                  <Button type="submit" size="sm" disabled={isPending}>
                    {isPending ? <Loader2 className="animate-spin" /> : null}
                    {ambiguousCreateFailure
                      ? 'Retry same request'
                      : createTask.isPending
                        ? 'Creating task…'
                        : runTask.isPending
                          ? 'Starting workflow…'
                          : 'Create and start'}
                  </Button>
                </>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
