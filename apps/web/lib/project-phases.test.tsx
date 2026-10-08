import type * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { phaseKeys, phaseService, usePhaseChange, useProjectPhases } from './project-phases';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('./api-client', () => ({
  api: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.delete },
  apiFetch: mocks.fetch,
}));

describe('project phase server state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const request of Object.values(mocks)) request.mockResolvedValue({ data: {}, meta: {} });
  });

  it('uses scoped phase CRUD and exact ordering payloads', async () => {
    const fields = { name: 'Foundation', description: null };
    await phaseService.change('project-1', { kind: 'create', fields });
    await phaseService.change('project-1', { kind: 'update', phaseId: 'phase-1', fields });
    await phaseService.change('project-1', { kind: 'order', phaseIds: ['phase-2', 'phase-1'] });
    await phaseService.change('project-1', { kind: 'delete', phaseId: 'phase-1' });
    expect(mocks.post).toHaveBeenCalledWith('/projects/project-1/phases', fields);
    expect(mocks.patch).toHaveBeenCalledWith('/projects/project-1/phases/phase-1', fields);
    expect(mocks.post).toHaveBeenCalledWith('/projects/project-1/phases/order', {
      phaseIds: ['phase-2', 'phase-1'],
    });
    expect(mocks.delete).toHaveBeenCalledWith('/projects/project-1/phases/phase-1');
  });

  it('posts bodyless lifecycle changes to encoded scoped routes', async () => {
    await phaseService.change('project/1', { kind: 'activate', phaseId: 'phase/1' });
    await phaseService.change('project/1', { kind: 'reopen', phaseId: 'phase/1' });
    expect(mocks.post).toHaveBeenNthCalledWith(
      1,
      '/projects/project%2F1/phases/phase%2F1/activate',
    );
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/projects/project%2F1/phases/phase%2F1/reopen');
  });

  it('links and unlinks through the same project-scoped membership route', async () => {
    await phaseService.change('project-1', { kind: 'link', phaseId: 'phase-1', taskId: 'task-1' });
    await phaseService.change('project-1', {
      kind: 'unlink',
      phaseId: 'phase-1',
      taskId: 'task-1',
    });
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      1,
      '/projects/project-1/phases/phase-1/tasks/task-1',
      { method: 'PUT' },
    );
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      '/projects/project-1/phases/phase-1/tasks/task-1',
      { method: 'DELETE' },
    );
  });

  it.each(['link', 'activate', 'reopen'] as const)(
    'invalidates phase, board and task caches after %s succeeds',
    async (kind) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const keys = [
        phaseKeys.project('project-1'),
        phaseKeys.detail('project-1', 'phase-1'),
        ['board', 'project-1'],
        ['tasks', 'task-1'],
        ['projects', 'project-1'],
      ];
      keys.forEach((key) => client.setQueryData(key, {}));
      client.setQueryData(phaseKeys.project('project-2'), {});
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(() => usePhaseChange('project-1'), { wrapper });
      await act(async () => {
        await result.current.mutateAsync(
          kind === 'link'
            ? { kind, phaseId: 'phase-1', taskId: 'task-1' }
            : { kind, phaseId: 'phase-1' },
        );
      });
      keys.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
      expect(client.getQueryState(phaseKeys.project('project-2'))?.isInvalidated).toBe(false);
      client.clear();
    },
  );

  it('preserves cached phases and exposes mutation errors on a conflict', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const cached = { items: [{ id: 'phase-1', name: 'Existing' }] };
    client.setQueryData(phaseKeys.project('project-1'), cached);
    mocks.delete.mockRejectedValue(new Error('A running task cannot be moved'));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => usePhaseChange('project-1'), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ kind: 'delete', phaseId: 'phase-1' }),
      ).rejects.toThrow('running task');
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(phaseKeys.project('project-1'))).toEqual(cached);
    expect(client.getQueryState(phaseKeys.project('project-1'))?.isInvalidated).toBe(false);
    client.clear();
  });

  it('exposes a phase loading failure for the query boundary', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.get.mockRejectedValue(new Error('Could not load phases'));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useProjectPhases('project-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Could not load phases');
    client.clear();
  });
});
