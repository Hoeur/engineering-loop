import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { RepositorySummary, TaskSummary } from '@/lib/types';
import {
  buildCreateTaskInput,
  emptyNewTaskForm,
  isDefinitiveCreateFailure,
  NewTaskDialog,
  toLines,
  validateNewTask,
} from './new-task-dialog';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  createTask: vi.fn(),
  runTask: vi.fn(),
  createMutate: vi.fn(),
  createReset: vi.fn(),
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
      reset: mocks.createReset,
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
    const [request, options] = mocks.createMutate.mock.calls[0] as [
      { body: unknown; idempotencyKey: string },
      { onSuccess: (task: TaskSummary) => void },
    ];
    expect(request.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(request.body).toEqual({
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
      reset: mocks.createReset,
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
      reset: mocks.createReset,
      isPending: false,
      isError: true,
      error: new ApiError('NOT_FOUND', 'Project not found', 404),
    });
    openDialog();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Add health endpoint' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));

    expect(screen.getByText('Project not found')).toBeVisible();
    expect(mocks.createMutate).toHaveBeenCalledOnce();
    expect(mocks.runMutate).not.toHaveBeenCalled();
  });

  it('clears a definitive 4xx attempt so a corrected retry gets new payload and key', () => {
    openDialog();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Original task title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));

    const firstRequest = mocks.createMutate.mock.calls[0]?.[0] as {
      body: { title: string };
      idempotencyKey: string;
    };
    const firstOptions = mocks.createMutate.mock.calls[0]?.[1] as {
      onError: (error: Error) => void;
    };
    act(() => firstOptions.onError(new ApiError('VALIDATION_FAILED', 'Fix the title', 422)));

    expect(screen.getByLabelText('Title')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Corrected task title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));

    const retryRequest = mocks.createMutate.mock.calls[1]?.[0] as typeof firstRequest;
    expect(retryRequest.idempotencyKey).not.toBe(firstRequest.idempotencyKey);
    expect(retryRequest.body.title).toBe('Corrected task title');
  });

  it('freezes an ambiguous attempt until exact retry or explicit discard', () => {
    openDialog();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Original task title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));

    const firstRequest = mocks.createMutate.mock.calls[0]?.[0] as {
      body: { title: string };
      idempotencyKey: string;
    };
    const firstOptions = mocks.createMutate.mock.calls[0]?.[1] as {
      onError: (error: Error) => void;
    };
    act(() => firstOptions.onError(new Error('Connection lost after commit')));

    expect(screen.getByText('The task creation outcome is unknown.')).toBeVisible();
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible();
    const overlay = screen.getByRole('dialog', { name: 'New task' }).previousElementSibling;
    expect(overlay).toBeInstanceOf(HTMLElement);
    fireEvent.pointerDown(overlay as HTMLElement, { button: 0, ctrlKey: false });
    fireEvent.click(overlay as HTMLElement);
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible();
    expect(mocks.createReset).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited after timeout' } });
    expect(screen.getByLabelText('Title')).toHaveValue('Original task title');
    fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));

    const retryRequest = mocks.createMutate.mock.calls[1]?.[0] as typeof firstRequest;
    expect(retryRequest.idempotencyKey).toBe(firstRequest.idempotencyKey);
    expect(retryRequest.body).toEqual(firstRequest.body);
    expect(retryRequest.body.title).toBe('Original task title');

    // The submit ref locks synchronously, before mutation state can re-render.
    fireEvent.click(screen.getByRole('button', { name: 'Discard and edit' }));
    expect(mocks.createReset).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Title')).toBeDisabled();

    const retryOptions = mocks.createMutate.mock.calls[1]?.[1] as {
      onError: (error: Error) => void;
    };
    act(() => retryOptions.onError(new ApiError('CONNECTION_FAILED', 'Still unknown', 0)));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and edit' }));

    expect(mocks.createReset).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Title')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited after discard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));
    const editedRequest = mocks.createMutate.mock.calls[2]?.[0] as typeof firstRequest;
    expect(editedRequest.idempotencyKey).not.toBe(firstRequest.idempotencyKey);
    expect(editedRequest.body.title).toBe('Edited after discard');
  });
});

describe('new task helpers', () => {
  it('treats 408, transport failures, and 5xx as ambiguous while other 4xx are definitive', () => {
    expect(isDefinitiveCreateFailure(new ApiError('TIMEOUT', 'Unknown outcome', 408))).toBe(false);
    expect(isDefinitiveCreateFailure(new ApiError('CONNECTION_FAILED', 'Offline', 0))).toBe(false);
    expect(isDefinitiveCreateFailure(new ApiError('INTERNAL_ERROR', 'Failed', 500))).toBe(false);
    expect(isDefinitiveCreateFailure(new ApiError('VALIDATION_FAILED', 'Invalid', 422))).toBe(true);
  });

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
