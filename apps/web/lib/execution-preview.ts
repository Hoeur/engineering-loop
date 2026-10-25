'use client';

import { useQuery } from '@tanstack/react-query';
import { executionPreviewSchema } from '@engloop/schemas';
import type { ExecutionPreviewRequest } from '@engloop/schemas';
import { api } from './api-client';

export const useExecutionPreview = (taskId: string, request: ExecutionPreviewRequest) =>
  useQuery({
    queryKey: ['execution-preview', taskId, request],
    queryFn: async () =>
      executionPreviewSchema.parse(
        (await api.post(`/tasks/${encodeURIComponent(taskId)}/execution-preview`, request)).data,
      ),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
