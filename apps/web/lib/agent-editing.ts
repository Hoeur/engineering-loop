'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateAgentDto, UpsertAgentDto } from '@engloop/schemas';
import { api } from './api-client';
import type { AgentSummary } from './types';

export interface AgentEditorDetails extends AgentSummary {
  systemPrompt: string | null;
  updatedAt: string;
}
export const useAgentEditor = (id?: string) =>
  useQuery({
    queryKey: ['agents', 'detail', id],
    enabled: Boolean(id),
    queryFn: async () =>
      (await api.get<AgentEditorDetails>(`/agents/${encodeURIComponent(id ?? '')}/editor`)).data,
  });
export const useSaveAgent = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: { id: string; body: UpdateAgentDto } | { body: UpsertAgentDto; id?: undefined },
    ) =>
      input.id
        ? (
            await api.patch<AgentEditorDetails>(
              `/agents/${encodeURIComponent(input.id)}`,
              input.body,
            )
          ).data
        : (await api.post<AgentEditorDetails>('/agents', input.body)).data,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['agents'] });
      void client.invalidateQueries({ queryKey: ['project-team'] });
      void client.invalidateQueries({ queryKey: ['agent-providers'] });
      void client.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });
};
