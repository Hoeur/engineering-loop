import type * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contractKey, contractService, useSaveProjectContract } from './project-contract';
const mocks = vi.hoisted(() => ({ get: vi.fn(), fetch: vi.fn() }));
vi.mock('./api-client', () => ({ api: { get: mocks.get }, apiFetch: mocks.fetch }));
const body = {
  objective: null,
  requirements: ['Audit writes'],
  nonGoals: [],
  acceptanceCriteria: [],
};
describe('project contract server state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ data: body });
    mocks.fetch.mockResolvedValue({ data: body });
  });
  it('reads and replaces through project-scoped routes', async () => {
    expect(await contractService.read('project-1')).toEqual(body);
    expect(await contractService.save('project-1', body)).toEqual(body);
    expect(mocks.get).toHaveBeenCalledWith('/projects/project-1/contract');
    expect(mocks.fetch).toHaveBeenCalledWith('/projects/project-1/contract', {
      method: 'PUT',
      body,
    });
  });
  it('invalidates changed contract data without touching another project', async () => {
    const client = new QueryClient();
    client.setQueryData(contractKey('project-1'), body);
    client.setQueryData(contractKey('project-2'), body);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSaveProjectContract('project-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(body);
    });
    expect(client.getQueryState(contractKey('project-1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(contractKey('project-2'))?.isInvalidated).toBe(false);
    client.clear();
  });
  it('preserves prior data after a failed replacement', async () => {
    const client = new QueryClient();
    client.setQueryData(contractKey('project-1'), body);
    mocks.fetch.mockRejectedValue(new Error('Forbidden'));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSaveProjectContract('project-1'), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ ...body, requirements: [] })).rejects.toThrow(
        'Forbidden',
      );
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(contractKey('project-1'))).toEqual(body);
    expect(client.getQueryState(contractKey('project-1'))?.isInvalidated).toBe(false);
    client.clear();
  });
});
