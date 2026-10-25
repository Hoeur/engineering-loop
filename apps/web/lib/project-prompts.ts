'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePromptTemplateDto, RevisePromptTemplateDto } from '@engloop/schemas';
import type {
  ProjectPromptTemplate,
  ProjectPromptRevision,
  ProjectPromptPreview,
  ProjectPromptOutputValidation,
} from '@engloop/types';
import { api } from './api-client';

export const promptsKey = (projectId: string) => ['project-prompts', projectId] as const;
const path = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/prompts`;
const revisionPath = (projectId: string, templateId: string, revision: number) =>
  `${path(projectId)}/${encodeURIComponent(templateId)}/revisions/${revision}`;

export const promptService = {
  list: async (projectId: string) => (await api.get<ProjectPromptTemplate[]>(path(projectId))).data,
  create: async (projectId: string, body: CreatePromptTemplateDto) =>
    (await api.post<ProjectPromptTemplate>(path(projectId), body)).data,
  read: async (projectId: string, templateId: string, revision: number) =>
    (await api.get<ProjectPromptRevision>(revisionPath(projectId, templateId, revision))).data,
  revise: async (projectId: string, templateId: string, body: RevisePromptTemplateDto) =>
    (
      await api.post<Omit<ProjectPromptRevision, 'template'>>(
        `${path(projectId)}/${encodeURIComponent(templateId)}/revisions`,
        body,
      )
    ).data,
  preview: async (projectId: string, templateId: string, revision: number, taskId: string) =>
    (
      await api.post<ProjectPromptPreview>(
        `${revisionPath(projectId, templateId, revision)}/preview`,
        { taskId },
      )
    ).data,
  validateOutput: async (
    projectId: string,
    templateId: string,
    revision: number,
    output: unknown,
  ) =>
    (
      await api.post<ProjectPromptOutputValidation>(
        `${revisionPath(projectId, templateId, revision)}/validate-output`,
        { output },
      )
    ).data,
};

export const useProjectPrompts = (projectId: string) =>
  useQuery({
    queryKey: promptsKey(projectId),
    queryFn: () => promptService.list(projectId),
    enabled: Boolean(projectId),
  });

export const usePromptRevision = (projectId: string, templateId: string, revision: number) =>
  useQuery({
    queryKey: [...promptsKey(projectId), templateId, revision],
    queryFn: () => promptService.read(projectId, templateId, revision),
  });

export const useCreatePrompt = (projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePromptTemplateDto) => promptService.create(projectId, body),
    onSuccess: () => client.invalidateQueries({ queryKey: promptsKey(projectId) }),
  });
};

export const useRevisePrompt = (projectId: string, templateId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: RevisePromptTemplateDto) =>
      promptService.revise(projectId, templateId, body),
    onSuccess: () => client.invalidateQueries({ queryKey: promptsKey(projectId) }),
  });
};

export const usePreviewPrompt = (
  projectId: string,
  templateId: string,
  revision: number,
  taskId: string,
) =>
  useMutation({ mutationFn: () => promptService.preview(projectId, templateId, revision, taskId) });

export const useValidatePromptOutput = (projectId: string, templateId: string, revision: number) =>
  useMutation({
    mutationFn: (output: unknown) =>
      promptService.validateOutput(projectId, templateId, revision, output),
  });
