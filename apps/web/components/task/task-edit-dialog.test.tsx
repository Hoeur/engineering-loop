import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskStatus } from '@engloop/types';
import type { TaskDetail } from '@/lib/types';
import { TaskEditDialog } from './task-edit-dialog';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  reload: vi.fn(),
  latest: null as TaskDetail | null,
  pending: false,
}));
vi.mock('@/lib/task-editing', () => ({
  useEditTask: () => ({ mutateAsync: mocks.save, isPending: mocks.pending }),
}));
vi.mock('@/lib/queries', () => ({
  useTask: () => ({ data: mocks.latest, refetch: mocks.reload }),
}));
const task = {
  id: 'task-one',
  title: 'Original task',
  objective: '',
  description: '',
  updatedAt: '2026-10-27T00:00:00.000Z',
  type: 'FEATURE',
  priority: 'MEDIUM',
  riskLevel: 'LOW',
  status: 'BACKLOG',
  acceptanceCriteria: ['Original criterion'],
  implementationNotes: [],
  suggestedFiles: [],
  requiredChecks: [],
  maxAttempts: 3,
  workflowRuns: [],
  agentRuns: [],
  testRuns: [],
  reviewRuns: [],
  commits: [],
  pullRequests: [],
  subtasks: [],
} as unknown as TaskDetail;
beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue(task);
  mocks.reload.mockReset();
  mocks.latest = task;
  mocks.pending = false;
});
const open = () => {
  render(<TaskEditDialog task={task} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit task' }));
};
describe('Task editing', () => {
  it('validates inputs and sends only changed fields with the loaded version', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('title');
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        title: 'Updated title',
        expectedUpdatedAt: task.updatedAt,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('retains the draft and original baseline after a conflict and polling refresh', async () => {
    mocks.save.mockRejectedValue(new Error('Task changed; reload before saving'));
    const view = render(<TaskEditDialog task={task} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit task' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'My draft' } });
    view.rerender(
      <TaskEditDialog
        task={{ ...task, updatedAt: '2026-10-27T01:00:00.000Z', description: 'Other writer' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Task changed');
    expect(screen.getByLabelText('Description')).toHaveValue('My draft');
    expect(mocks.save).toHaveBeenLastCalledWith({
      description: 'My draft',
      expectedUpdatedAt: task.updatedAt,
    });
  });
  it('reloads the baseline only after an explicit reload', async () => {
    open();
    mocks.reload.mockResolvedValue({
      data: { ...task, title: 'Other writer', updatedAt: '2026-10-27T01:00:00.000Z' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved task' }));
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Other writer'));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        title: 'New draft',
        expectedUpdatedAt: '2026-10-27T01:00:00.000Z',
      }),
    );
  });
  it.each([TaskStatus.QUEUED, TaskStatus.IMPLEMENTING, TaskStatus.COMPLETED])(
    'locks %s tasks',
    (status) => {
      mocks.latest = { ...task, status };
      open();
      expect(screen.getByRole('button', { name: 'Save task' })).toBeDisabled();
      expect(screen.getByLabelText('Title')).toBeDisabled();
    },
  );
  it('prevents duplicate submission and dismissal while saving', async () => {
    mocks.save.mockReturnValue(new Promise(() => {}));
    open();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New draft' } });
    const save = screen.getByRole('button', { name: 'Save task' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
});
