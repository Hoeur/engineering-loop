'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateTaskDto } from '@engloop/schemas';
import { api } from './api-client';
import type { TaskSummary } from './types';

export const useEditTask = (id: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateTaskDto) =>
      (await api.patch<TaskSummary>(`/tasks/${encodeURIComponent(id)}`, body)).data,
    onSuccess: (task) => {
      void client.invalidateQueries({ queryKey: ['tasks'] });
      void client.invalidateQueries({ queryKey: ['projects', task.projectId] });
      void client.invalidateQueries({ queryKey: ['board', task.projectId] });
      void client.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });
};
