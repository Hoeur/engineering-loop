import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { RepositorySummary, TaskSummary } from '@/lib/types';
import {
  buildCreateTaskInput,
  emptyNewTaskForm,
  NewTaskDialog,
  toLines,
  validateNewTask,
} from './new-task-dialog';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  createTask: vi.fn(),
  runTask: vi.fn(),
  createMutate: vi.fn(),
  runMutate: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/queries', () => ({
  useCreateTask: mocks.createTask,
  useRunTask: mocks.runTask,
}));

const repository = {
  id: 'repo-1',
  name: 'chat-gate-frontend',
  provider: 'GITHUB',
  status: 'ACTIVE',
  defaultBranch: 'main',
  primaryLanguage: 'TypeScript',
  frameworks: [],
  packageManager: 'npm',
  remoteUrl: null,
} satisfies RepositorySummary;

const openDialog = (): void => {
  render(<NewTaskDialog projectId="project-1" repositories={[repository]} />);
  fireEvent.click(screen.getByRole('button', { name: 'New task' }));
};

describe('NewTaskDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTask.mockReturnValue({
      mutate: mocks.createMutate,
      isPending: false,
      isError: false,
      error: null,
    });
    mocks.runTask.mockReturnValue({
      mutate: mocks.runMutate,
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it('refuses a title that is too short without calling the API', () => {
    openDialog();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));

    expect(screen.getByText('Give the task a title of at least 3 characters.')).toBeVisible();
    expect(mocks.createMutate).not.toHaveBeenCalled();
  });

  it('creates the task, starts planning, and opens the live workflow run', () => {
    openDialog();
    expect(screen.getByText('Repository: chat-gate-frontend')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: '  Health check: make lint and typecheck pass on main ' },
    });
    fireEvent.change(screen.getByLabelText('Acceptance criteria'), {
      target: { value: '`npm run lint` exits 0\n\n  `npm run typecheck` exits 0  ' },
    });
    fireEvent.change(screen.getByLabelText('Max attempts'), { target: { value: '1' } });
    fireEvent.click(screen.getByLabelText('Lint'));
    fireEvent.click(screen.getByLabelText('Typecheck'));
    fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));

    expect(mocks.createMutate).toHaveBeenCalledOnce();
    const [body, options] = mocks.createMutate.mock.calls[0] as [
      unknown,
      { onSuccess: (task: TaskSummary) => void },
    ];
    expect(body).toEqual({
      projectId: 'project-1',
      repositoryId: 'repo-1',
      title: 'Health check: make lint and typecheck pass on main',
      objective: '',
      description: '',
      type: 'FEATURE',
      priority: 'MEDIUM',
      riskLevel: 'MEDIUM',
      acceptanceCriteria: ['`npm run lint` exits 0', '`npm run typecheck` exits 0'],
      requiredChecks: ['LINT', 'TYPECHECK'],
      maxAttempts: 1,
    });

    const task = { id: 'task-9', projectId: 'project-1' } as TaskSummary;
    act(() => options.onSuccess(task));
    expect(mocks.runMutate).toHaveBeenCalledWith(
      {
        taskId: 'task-9',
        workflowKey: 'engineering-task',
        skipPlanning: false,
        force: false,
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );

    const runOptions = mocks.runMutate.mock.calls[0]?.[1] as {
      onSuccess: (run: { id: string }) => void;
    };
    act(() => runOptions.onSuccess({ id: 'workflow-7' }));
    expect(mocks.push).toHaveBeenCalledWith('/engineering/runs/workflow-7');
  });

  it('locks submission synchronously so repeated submits create only one task', () => {
    openDialog();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Add health endpoint' } });
    const submit = screen.getByRole('button', { name: 'Create and start' });

    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(mocks.createMutate).toHaveBeenCalledOnce();
    expect(mocks.runMutate).not.toHaveBeenCalled();
  });

  it('keeps the created task available when workflow start fails and retries without recreating', () => {
    openDialog();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Add health endpoint' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));

    const createOptions = mocks.createMutate.mock.calls[0]?.[1] as {
      onSuccess: (task: TaskSummary) => void;
    };
    const task = { id: 'task-9', projectId: 'project-1' } as TaskSummary;
    act(() => createOptions.onSuccess(task));
    const runOptions = mocks.runMutate.mock.calls[0]?.[1] as {
      onError: (error: Error) => void;
    };
    act(() => runOptions.onError(new Error('Queue unavailable')));

    expect(screen.getByText('Task created, but the workflow did not start.')).toBeVisible();
    expect(screen.getByText('Queue unavailable')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Retry workflow start' }));

    expect(mocks.createMutate).toHaveBeenCalledOnce();
    expect(mocks.runMutate).toHaveBeenCalledTimes(2);
    expect(mocks.runMutate).toHaveBeenLastCalledWith(
      {
        taskId: 'task-9',
        workflowKey: 'engineering-task',
        skipPlanning: false,
        force: false,
      },
      expect.any(Object),
    );

    const retryOptions = mocks.runMutate.mock.calls[1]?.[1] as {
      onError: (error: Error) => void;
    };
    act(() => retryOptions.onError(new Error('Queue still unavailable')));
    fireEvent.click(screen.getByRole('button', { name: 'Open created task' }));
    expect(mocks.push).toHaveBeenCalledWith('/engineering/tasks/task-9');
    expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeInTheDocument();
  });

  it('dismisses partial-failure recovery without navigating and reopens a fresh form', () => {
    openDialog();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Add health endpoint' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));

    const createOptions = mocks.createMutate.mock.calls[0]?.[1] as {
      onSuccess: (task: TaskSummary) => void;
    };
    act(() => createOptions.onSuccess({ id: 'task-9', projectId: 'project-1' } as TaskSummary));
    const runOptions = mocks.runMutate.mock.calls[0]?.[1] as {
      onError: (error: Error) => void;
    };
    act(() => runOptions.onError(new Error('Queue unavailable')));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(
      screen.queryByText('Task created, but the workflow did not start.'),
    ).not.toBeInTheDocument();
  });

  it('opens the existing workflow when start reports TASK_ALREADY_RUNNING', () => {
    openDialog();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Add health endpoint' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));

    const createOptions = mocks.createMutate.mock.calls[0]?.[1] as {
      onSuccess: (task: TaskSummary) => void;
    };
    act(() => createOptions.onSuccess({ id: 'task-9', projectId: 'project-1' } as TaskSummary));
    const runOptions = mocks.runMutate.mock.calls[0]?.[1] as {
      onError: (error: Error) => void;
    };
    act(() =>
      runOptions.onError(
        new ApiError('TASK_ALREADY_RUNNING', 'Task already has a run', 409, {
          workflowRunId: 'workflow-existing',
        }),
      ),
    );

    expect(mocks.push).toHaveBeenCalledWith('/engineering/runs/workflow-existing');
    expect(
      screen.queryByText('Task created, but the workflow did not start.'),
    ).not.toBeInTheDocument();
  });

  it('prevents dialog dismissal while an operation is pending', () => {
    mocks.createTask.mockReturnValue({
      mutate: mocks.createMutate,
      isPending: true,
      isError: false,
      error: null,
    });
    openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible();
  });

  it('shows a create error inline and does not attempt to start a workflow', () => {
    mocks.createTask.mockReturnValue({
      mutate: mocks.createMutate,
      isPending: false,
      isError: true,
      error: new Error('Project not found'),
    });
    openDialog();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Add health endpoint' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));

    expect(screen.getByText('Project not found')).toBeVisible();
    expect(mocks.createMutate).toHaveBeenCalledOnce();
    expect(mocks.runMutate).not.toHaveBeenCalled();
  });
});

describe('new task helpers', () => {
  it('keeps one acceptance criterion per non-empty line', () => {
    expect(toLines(' first \r\n\n second\n   ')).toEqual(['first', 'second']);
  });

  it('checks the same limits as the API', () => {
    const form = { ...emptyNewTaskForm([]), title: 'Fix the login redirect' };
    expect(validateNewTask(form)).toBeNull();
    expect(validateNewTask({ ...form, maxAttempts: '0' })).toMatch(/1 to 10/);
    expect(validateNewTask({ ...form, maxAttempts: '2.5' })).toMatch(/1 to 10/);
    expect(validateNewTask({ ...form, title: 'x'.repeat(201) })).toMatch(/200/);
  });

  it('leaves the repository out when the project has none', () => {
    const body = buildCreateTaskInput('project-1', { ...emptyNewTaskForm([]), title: 'Docs' });
    expect(body).not.toHaveProperty('repositoryId');
  });
});
