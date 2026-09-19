'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api-client';

export interface EpicRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  targetDate: string | null;
  features?: { id: string; title: string; status: string }[];
  _count?: { tasks: number };
}

export interface FeatureRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  epic?: { id: string; title: string } | null;
  _count?: { tasks: number };
}

export const useEpics = (projectId?: string) =>
  useQuery({
    queryKey: ['epics', projectId ?? 'all'],
    queryFn: () =>
      api.get<{ items: EpicRow[] }>('/epics', { query: { projectId } }).then((r) => r.data),
  });

export const useFeatures = (projectId?: string) =>
  useQuery({
    queryKey: ['features', projectId ?? 'all'],
    queryFn: () =>
      api.get<{ items: FeatureRow[] }>('/features', { query: { projectId } }).then((r) => r.data),
  });
