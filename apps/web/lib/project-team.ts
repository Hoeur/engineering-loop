'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectTeam } from '@engloop/types';
import type { ReplaceProjectTeamDto } from '@engloop/schemas';
import { api, apiFetch } from './api-client';

export const teamKey = (projectId: string) => ['project-team', projectId] as const;
const path = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/team`;
export const teamService = {
  read: async (projectId: string): Promise<ProjectTeam> =>
    (await api.get<ProjectTeam>(path(projectId))).data,
  save: async (projectId: string, body: ReplaceProjectTeamDto): Promise<ProjectTeam> =>
    (await apiFetch<ProjectTeam>(path(projectId), { method: 'PUT', body })).data,
};
export const useProjectTeam = (projectId: string) =>
  useQuery({
    queryKey: teamKey(projectId),
    queryFn: () => teamService.read(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 15_000,
  });
export const useSaveProjectTeam = (projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ReplaceProjectTeamDto) => teamService.save(projectId, body),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: teamKey(projectId) }),
        client.invalidateQueries({ queryKey: ['agents'] }),
      ]),
  });
};
