import type * as React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { teamKey, teamService, useSaveProjectTeam } from './project-team';
const mocks = vi.hoisted(() => ({ get: vi.fn(), fetch: vi.fn() }));
vi.mock('./api-client', () => ({ api: { get: mocks.get }, apiFetch: mocks.fetch }));
const body = { expectedVersion: 0, memberIds: [], requiredRoles: [] };
describe('Project team server state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ data: body });
    mocks.fetch.mockResolvedValue({ data: body });
  });
  it('uses encoded project-scoped GET and PUT routes', async () => {
    await teamService.read('project/one');
    await teamService.save('project/one', body);
    expect(mocks.get).toHaveBeenCalledWith('/projects/project%2Fone/team');
    expect(mocks.fetch).toHaveBeenCalledWith('/projects/project%2Fone/team', {
      method: 'PUT',
      body,
    });
  });
  it.each([true, false])(
    'invalidates only the changed project after success=%s',
    async (success) => {
      const client = new QueryClient();
      client.setQueryData(teamKey('one'), body);
      client.setQueryData(teamKey('two'), body);
      if (!success) mocks.fetch.mockRejectedValue(new Error('Locked'));
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(() => useSaveProjectTeam('one'), { wrapper });
      await act(async () => {
        if (success) await result.current.mutateAsync(body);
        else await expect(result.current.mutateAsync(body)).rejects.toThrow('Locked');
      });
      expect(client.getQueryState(teamKey('one'))?.isInvalidated).toBe(success);
      expect(client.getQueryState(teamKey('two'))?.isInvalidated).toBe(false);
      expect(client.getQueryData(teamKey('one'))).toEqual(body);
      client.clear();
    },
  );
});
