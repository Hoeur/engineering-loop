import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionPreviewRequest } from '@engloop/schemas';
import type * as ApiClient from '@/lib/api-client';
import { TaskExecutionDialog } from './task-execution-dialog';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  api: { get: mocks.get, post: mocks.post },
}));

const result = (request: ExecutionPreviewRequest) => ({
  capturedAt: new Date().toISOString(),
  taskId: 'task-one',
  roles: [
    {
      role: request.mode === 'plan' ? 'PLANNER' : 'IMPLEMENTER',
      agentId: 'agent-one',
      providerKey: 'mock',
      providerKind: 'MOCK',
      model: 'pinned-model',
      permissionLevel: 'LEVEL_2_CODE',
      budget: { timeoutMs: 1000, maxTokens: 200, maxCostUsd: 1, allowedCommands: ['git'] },
      ...(request.execution.prompts.length
        ? {
            prompt: {
              templateId: request.execution.prompts[0]!.templateId,
              revision: request.execution.prompts[0]!.revision,
              body: 'Saved',
              rendered: `Saved revision ${request.execution.prompts[0]?.revision}`,
            },
          }
        : {}),
    },
  ],
});

const mount = (mode: 'plan' | 'run' = 'run') => {
  const start = vi.fn().mockResolvedValue(true);
  const close = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TaskExecutionDialog
        taskId="task-one"
        projectId="project-one"
        mode={mode}
        skipPlanning={mode === 'run'}
        start={start}
        close={close}
      />
    </QueryClientProvider>,
  );
  return { start, close };
};

describe('Task execution dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({
      data: [
        { id: 'template-one', name: 'Implement prompt', role: 'IMPLEMENTER', currentRevision: 2 },
      ],
    });
    mocks.post.mockImplementation(async (_path: string, request: ExecutionPreviewRequest) => ({
      data: result(request),
    }));
  });

  it('preserves legacy start without a snapshot or preview request', async () => {
    const { start, close } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(start).toHaveBeenCalledWith(undefined);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('submits an exact historical revision after preview, ignoring late results for an older selection', async () => {
    const { start } = mount();
    fireEvent.click(screen.getByLabelText('Use frozen execution settings'));
    await screen.findByLabelText('IMPLEMENTER prompt');
    let resolveOld: (value: unknown) => void = () => {};
    mocks.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    fireEvent.change(screen.getByLabelText('IMPLEMENTER prompt'), {
      target: { value: 'template-one' },
    });
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          execution: {
            prompts: [{ role: 'IMPLEMENTER', templateId: 'template-one', revision: 2 }],
          },
        }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('IMPLEMENTER revision'), { target: { value: '1' } });
    await screen.findByText('Saved revision 1');
    await act(async () =>
      resolveOld({
        data: result({
          mode: 'run',
          skipPlanning: true,
          execution: {
            prompts: [{ role: 'IMPLEMENTER', templateId: 'template-one', revision: 2 }],
          },
        }),
      }),
    );
    expect(screen.queryByText('Saved revision 2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith({
        prompts: [{ role: 'IMPLEMENTER', templateId: 'template-one', revision: 1 }],
      }),
    );
  });

  it('blocks start on preview failures and invalid revision numbers while retaining choices', async () => {
    const { start } = mount();
    fireEvent.click(screen.getByLabelText('Use frozen execution settings'));
    await screen.findByLabelText('IMPLEMENTER prompt');
    mocks.post.mockRejectedValueOnce(new Error('Unresolved prompt variable: task.objective'));
    fireEvent.change(screen.getByLabelText('IMPLEMENTER prompt'), {
      target: { value: 'template-one' },
    });
    await screen.findByText(/Unresolved prompt variable/);
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('IMPLEMENTER revision'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('positive whole revision');
    expect(start).not.toHaveBeenCalled();
  });

  it('previews planner roles and keeps the dialog open on start rejection', async () => {
    const { start, close } = mount('plan');
    start.mockResolvedValue(false);
    fireEvent.click(screen.getByLabelText('Use frozen execution settings'));
    await screen.findByLabelText('PLANNER prompt');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run planner' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Run planner' }));
    await screen.findByRole('alert');
    expect(start).toHaveBeenCalledWith({ prompts: [] });
    expect(close).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledWith('/tasks/task-one/execution-preview', {
      mode: 'plan',
      skipPlanning: false,
      execution: { prompts: [] },
    });
  });
});
