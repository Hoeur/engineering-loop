'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { CheckType, Priority, RiskLevel, TaskType } from '@engloop/types';
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
import { useCreateTask } from '@/lib/queries';
import type { CreateTaskInput, RepositorySummary } from '@/lib/types';

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

const errorMessage = (error: unknown): string =>
  error instanceof ApiError || error instanceof Error ? error.message : 'Could not create the task';

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
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<NewTaskForm>(() => emptyNewTaskForm(repositories));
  const [validation, setValidation] = React.useState<string | null>(null);

  const update = <K extends keyof NewTaskForm>(key: K, value: NewTaskForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleCheck = (check: CheckType): void => {
    setForm((current) => ({
      ...current,
      requiredChecks: current.requiredChecks.includes(check)
        ? current.requiredChecks.filter((entry) => entry !== check)
        : [...current.requiredChecks, check],
    }));
  };

  // `mutate`, not `mutateAsync`: an API error is shown inline instead of escaping as an
  // unhandled rejection (which Next.js dev turns into a full-page overlay).
  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const problem = validateNewTask(form);
    setValidation(problem);
    if (problem) return;
    createTask.mutate(buildCreateTaskInput(projectId, form), {
      onSuccess: (task) => {
        setOpen(false);
        setForm(emptyNewTaskForm(repositories));
        router.push(`/engineering/tasks/${task.id}`);
      },
    });
  };

  const repositoryName = repositories.find((entry) => entry.id === form.repositoryId)?.name;

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus /> New task
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>
              Describe the change. The task starts in the backlog; open it and press Run to start
              the agents.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={submit} noValidate>
            <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
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
            </div>

            {validation ? <p className="text-sm text-danger">{validation}</p> : null}
            {createTask.isError ? (
              <p className="text-sm text-danger">{errorMessage(createTask.error)}</p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={createTask.isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={createTask.isPending}>
                {createTask.isPending ? <Loader2 className="animate-spin" /> : null}
                Create task
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
