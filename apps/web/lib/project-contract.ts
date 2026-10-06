'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectContract } from '@engloop/types';
import { api, apiFetch } from './api-client';

export const contractKey = (projectId: string) => ['project-contract', projectId] as const;
const path = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/contract`;
export const contractService = {
  read: async (projectId: string): Promise<ProjectContract> =>
    (await api.get<ProjectContract>(path(projectId))).data,
  save: async (projectId: string, body: ProjectContract): Promise<ProjectContract> =>
    (await apiFetch<ProjectContract>(path(projectId), { method: 'PUT', body })).data,
};
export const useProjectContract = (projectId: string) =>
  useQuery({
    queryKey: contractKey(projectId),
    queryFn: () => contractService.read(projectId),
    enabled: Boolean(projectId),
  });
export const useSaveProjectContract = (projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectContract) => contractService.save(projectId, body),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: contractKey(projectId) });
    },
  });
};
