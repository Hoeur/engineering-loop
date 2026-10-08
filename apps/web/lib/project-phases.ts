'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectPhaseDetail, ProjectPhaseSummary } from '@engloop/types';
import type { CreateProjectPhaseDto } from '@engloop/schemas';
import { api, apiFetch } from './api-client';
import { queryKeys } from './queries';

export const phaseKeys = {
  project: (projectId: string) => ['project-phases', projectId] as const,
  detail: (projectId: string, phaseId: string) => ['project-phases', projectId, phaseId] as const,
};

type PhaseFields = CreateProjectPhaseDto;
export type PhaseChange =
  | { kind: 'create'; fields: PhaseFields }
  | { kind: 'update'; phaseId: string; fields: PhaseFields }
  | { kind: 'delete' | 'activate' | 'reopen'; phaseId: string }
  | { kind: 'order'; phaseIds: string[] }
  | { kind: 'link' | 'unlink'; phaseId: string; taskId: string };

const phasePath = (projectId: string): string =>
  `/projects/${encodeURIComponent(projectId)}/phases`;

export const phaseService = {
  list: async (projectId: string) =>
    (await api.get<{ items: ProjectPhaseSummary[] }>(phasePath(projectId))).data,
  detail: async (projectId: string, phaseId: string) =>
    (await api.get<ProjectPhaseDetail>(`${phasePath(projectId)}/${encodeURIComponent(phaseId)}`))
      .data,
  change: async (projectId: string, change: PhaseChange): Promise<unknown> => {
    const path = phasePath(projectId);
    switch (change.kind) {
      case 'create':
        return (await api.post(path, change.fields)).data;
      case 'update':
        return (await api.patch(`${path}/${encodeURIComponent(change.phaseId)}`, change.fields))
          .data;
      case 'activate':
      case 'reopen':
        return (await api.post(`${path}/${encodeURIComponent(change.phaseId)}/${change.kind}`))
          .data;
      case 'delete':
        return (await api.delete(`${path}/${encodeURIComponent(change.phaseId)}`)).data;
      case 'order':
        return (await api.post(`${path}/order`, { phaseIds: change.phaseIds })).data;
      case 'link':
      case 'unlink':
        return (
          await apiFetch(
            `${path}/${encodeURIComponent(change.phaseId)}/tasks/${encodeURIComponent(change.taskId)}`,
            {
              method: change.kind === 'link' ? 'PUT' : 'DELETE',
            },
          )
        ).data;
    }
  },
};

export const useProjectPhases = (projectId: string) =>
  useQuery({
    queryKey: phaseKeys.project(projectId),
    queryFn: () => phaseService.list(projectId),
    enabled: Boolean(projectId),
  });

export const usePhaseDetail = (projectId: string, phaseId: string) =>
  useQuery({
    queryKey: phaseKeys.detail(projectId, phaseId),
    queryFn: () => phaseService.detail(projectId, phaseId),
    enabled: Boolean(projectId && phaseId),
  });

export const usePhaseChange = (projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: PhaseChange) => phaseService.change(projectId, change),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: phaseKeys.project(projectId) }),
        client.invalidateQueries({ queryKey: queryKeys.board(projectId) }),
        client.invalidateQueries({ queryKey: ['tasks'] }),
        client.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      ]);
    },
  });
};
