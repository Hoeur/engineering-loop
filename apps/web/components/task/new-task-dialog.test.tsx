import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositorySummary } from '@/lib/types';
import {
  buildCreateTaskInput,
  emptyNewTaskForm,
  NewTaskDialog,
  toLines,
  validateNewTask,
} from './new-task-dialog';

const mocks = vi.hoisted(() => ({ push: vi.fn(), createTask: vi.fn(), mutate: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/queries', () => ({ useCreateTask: mocks.createTask }));

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
      mutate: mocks.mutate,
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it('refuses a title that is too short without calling the API', () => {
    openDialog();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    expect(screen.getByText('Give the task a title of at least 3 characters.')).toBeVisible();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('creates the task on the only repository and opens it', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    expect(mocks.mutate).toHaveBeenCalledOnce();
    const [body, options] = mocks.mutate.mock.calls[0] as [
      unknown,
      { onSuccess: (task: { id: string }) => void },
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

    act(() => options.onSuccess({ id: 'task-9' }));
    expect(mocks.push).toHaveBeenCalledWith('/engineering/tasks/task-9');
  });

  it('shows the API error inline', () => {
    mocks.createTask.mockReturnValue({
      mutate: mocks.mutate,
      isPending: false,
      isError: true,
      error: new Error('Project not found'),
    });
    openDialog();

    expect(screen.getByText('Project not found')).toBeVisible();
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
