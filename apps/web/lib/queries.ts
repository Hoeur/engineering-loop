'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { TaskStatus } from '@engloop/types';
import { api } from './api-client';
import type {
  AgentPerformanceRow,
  AgentSummary,
  AgentProviderSummary,
  AgentRunDetail,
  AgentRunSummary,
  AgentTeamRow,
  ApprovalSummary,
  AuditLogSummary,
  CostSummary,
  CreateTaskInput,
  CurrentUser,
  DashboardOverview,
  DeliveryMetrics,
  GitHubInstallationSummary,
  GitHubRepositoryCandidate,
  InboxItem,
  NotificationSummary,
  Paginated,
  ProjectSummary,
  PullRequestSummary,
  RepositorySummary,
  ReviewFindingSummary,
  ReviewRunSummary,
  ScheduleSummary,
  TaskDetail,
  TaskSummary,
  TestRunSummary,
  UpdateAgentInput,
  UpsertProviderInput,
  UsageSummary,
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorktreeSummary,
} from './types';

/** Query keys are centralised so invalidation after a mutation is exact. */
export const queryKeys = {
  overview: ['dashboard', 'overview'] as const,
  deliveryMetrics: ['dashboard', 'delivery'] as const,
  projects: (params?: unknown) => ['projects', params ?? {}] as const,
  project: (id: string) => ['projects', id] as const,
  repositories: (projectId?: string) => ['repositories', projectId ?? 'all'] as const,
  tasks: (params?: unknown) => ['tasks', params ?? {}] as const,
  task: (id: string) => ['tasks', id] as const,
  board: (projectId: string) => ['board', projectId] as const,
  agentRuns: (params?: unknown) => ['agent-runs', params ?? {}] as const,
  agentRun: (id: string) => ['agent-runs', id] as const,
  agents: (params?: unknown) => ['agents', params ?? {}] as const,
  agentTeam: (projectId?: string) => ['agents', 'team', projectId ?? 'org'] as const,
  agentPerformance: ['agents', 'performance'] as const,
  providers: ['agent-providers'] as const,
  currentUser: ['auth', 'me'] as const,
  workflows: ['workflows'] as const,
  workflowRuns: (params?: unknown) => ['workflow-runs', params ?? {}] as const,
  workflowRun: (id: string) => ['workflow-runs', id] as const,
  testRuns: (params?: unknown) => ['test-runs', params ?? {}] as const,
  reviewRuns: (params?: unknown) => ['review-runs', params ?? {}] as const,
  findings: (params?: unknown) => ['review-findings', params ?? {}] as const,
  inbox: (params?: unknown) => ['inbox', params ?? {}] as const,
  schedules: (projectId?: string) => ['schedules', projectId ?? 'all'] as const,
  pullRequests: (params?: unknown) => ['pull-requests', params ?? {}] as const,
  worktrees: ['worktrees'] as const,
  usage: (params?: unknown) => ['usage', params ?? {}] as const,
  costs: (params?: unknown) => ['costs', params ?? {}] as const,
  costsByTask: ['costs', 'by-task'] as const,
  audit: (params?: unknown) => ['audit-logs', params ?? {}] as const,
  notifications: (params?: unknown) => ['notifications', params ?? {}] as const,
  approvals: (params?: unknown) => ['approvals', params ?? {}] as const,
  health: ['health'] as const,
  githubInstallations: ['github', 'installations'] as const,
  githubRepositories: (installationId: string) =>
    ['github', 'installations', installationId, 'repositories'] as const,
};

const unwrap = <T>(promise: Promise<{ data: T }>): Promise<T> =>
  promise.then((response) => response.data);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const useOverview = (): UseQueryResult<DashboardOverview> =>
  useQuery({
    queryKey: queryKeys.overview,
    queryFn: () => unwrap(api.get<DashboardOverview>('/dashboard/overview')),
    refetchInterval: 15_000,
  });

export const useDeliveryMetrics = (): UseQueryResult<DeliveryMetrics> =>
  useQuery({
    queryKey: queryKeys.deliveryMetrics,
    queryFn: () => unwrap(api.get<DeliveryMetrics>('/dashboard/delivery-metrics')),
  });

// ---------------------------------------------------------------------------
// Projects & repositories
// ---------------------------------------------------------------------------

export const useProjects = (params?: { search?: string; status?: string }) =>
  useQuery({
    queryKey: queryKeys.projects(params),
    queryFn: () => unwrap(api.get<Paginated<ProjectSummary>>('/projects', { query: params })),
  });

export const useProject = (id: string) =>
  useQuery({
    queryKey: queryKeys.project(id),
    queryFn: () =>
      unwrap(
        api.get<ProjectSummary & { taskCountsByStatus: Record<string, number> }>(`/projects/${id}`),
      ),
    enabled: Boolean(id),
  });

export const useRepositories = (projectId?: string) =>
  useQuery({
    queryKey: queryKeys.repositories(projectId),
    queryFn: () =>
      unwrap(api.get<{ items: RepositorySummary[] }>('/repositories', { query: { projectId } })),
  });

export const useGitHubInstallations = () =>
  useQuery({
    queryKey: queryKeys.githubInstallations,
    queryFn: () => unwrap(api.get<{ items: GitHubInstallationSummary[] }>('/github/installations')),
    retry: false,
  });

export const useGitHubRepositories = (installationId: string) =>
  useQuery({
    queryKey: queryKeys.githubRepositories(installationId),
    queryFn: () =>
      unwrap(
        api.get<{ items: GitHubRepositoryCandidate[] }>(
          `/github/installations/${installationId}/repositories`,
        ),
      ),
    enabled: Boolean(installationId),
    retry: false,
  });

export const useStartGitHubAuthorization = () =>
  useMutation({
    mutationFn: () =>
      unwrap(
        api.post<{
          authorizationUrl: string;
          mode: 'install' | 'authorize';
          installUrl: string;
          state: string;
          expiresAt: string;
        }>('/github/authorization/start', {}),
      ),
  });

export const useCompleteGitHubAuthorization = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      code: string;
      state: string;
      /** Absent when the App was already installed; every reachable installation connects. */
      installationId?: string;
      setupAction?: string;
    }) =>
      unwrap(
        api.post<{
          installation: GitHubInstallationSummary;
          installations: GitHubInstallationSummary[];
          redirectUri: string;
        }>('/github/authorization/complete', body),
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.githubInstallations }),
  });
};

export const useImportGitHubRepository = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { installationId: string; repositoryId: string }) =>
      unwrap(
        api.post<{ project: ProjectSummary; repository: RepositorySummary }>(
          '/github/repositories/import',
          body,
        ),
      ),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['repositories'] });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.githubRepositories(variables.installationId),
      });
    },
  });
};

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface TaskFilters extends Record<string, string | number | string[] | undefined> {
  projectId?: string;
  repositoryId?: string;
  status?: string[];
  type?: string;
  priority?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export const useTasks = (filters: TaskFilters = {}) =>
  useQuery({
    queryKey: queryKeys.tasks(filters),
    queryFn: () => unwrap(api.get<Paginated<TaskSummary>>('/tasks', { query: filters })),
    refetchInterval: 20_000,
  });

export const useTask = (id: string) =>
  useQuery({
    queryKey: queryKeys.task(id),
    queryFn: () => unwrap(api.get<TaskDetail>(`/tasks/${id}`)),
    enabled: Boolean(id),
    refetchInterval: 10_000,
  });

export const useBoard = (projectId: string) =>
  useQuery({
    queryKey: queryKeys.board(projectId),
    queryFn: () => unwrap(api.get<{ items: TaskSummary[] }>(`/projects/${projectId}/board`)),
    enabled: Boolean(projectId),
    refetchInterval: 20_000,
  });

export const useCreateTask = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskInput) => unwrap(api.post<TaskSummary>('/tasks', body)),
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.board(task.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(task.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
};

/** Every task action shares one mutation so invalidation stays consistent. */
export const useTaskAction = (
  taskId: string,
): UseMutationResult<unknown, Error, { action: string; body?: unknown }> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }) => api.post(`/tasks/${taskId}/${action}`, body ?? {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['board'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      void queryClient.invalidateQueries({ queryKey: ['workflow-runs'] });
    },
  });
};

export const useTransitionTask = (taskId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { to: TaskStatus; reason?: string }) =>
      api.post(`/tasks/${taskId}/transition`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
  });
};

export const useAddComment = (taskId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post(`/tasks/${taskId}/comments`, { body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) }),
  });
};

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const useAgents = (params?: { projectId?: string; role?: string }) =>
  useQuery({
    queryKey: queryKeys.agents(params),
    queryFn: () => unwrap(api.get<{ items: AgentSummary[] }>('/agents', { query: params })),
  });

/**
 * Updates one agent's execution limits.
 *
 * These are what actually bound a run: the worker resolves the agent row's
 * maxTokens/maxCostUsd/timeoutMs and falls back to the process-wide defaults
 * only for an agent that sets none.
 */
export const useUpdateAgent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateAgentInput & { id: string }) =>
      unwrap(api.patch<AgentSummary>(`/agents/${id}`, body)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
};

export const useAgentTeam = (projectId?: string) =>
  useQuery({
    queryKey: queryKeys.agentTeam(projectId),
    queryFn: () =>
      unwrap(
        api.get<{ items: AgentTeamRow[]; meta: unknown }>('/agents/team', { query: { projectId } }),
      ),
  });

export const useAgentPerformance = () =>
  useQuery({
    queryKey: queryKeys.agentPerformance,
    queryFn: () => unwrap(api.get<{ items: AgentPerformanceRow[] }>('/agents/performance')),
  });

export const useProviders = () =>
  useQuery({
    queryKey: queryKeys.providers,
    queryFn: () => unwrap(api.get<{ items: AgentProviderSummary[] }>('/agent-providers')),
  });

export const useCurrentUser = () =>
  useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: () => unwrap(api.get<CurrentUser>('/auth/me')),
  });

/**
 * Writes a provider, including its API key.
 *
 * The key travels once, on the way in: the response carries a redacted preview
 * and never the value, so nothing here is worth caching.
 */
export const useUpsertProvider = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertProviderInput) =>
      unwrap(api.post<AgentProviderSummary & { credentialPreview: string | null }>(
        '/agent-providers',
        body,
      )),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers });
    },
  });
};

export const useAgentRuns = (params?: {
  taskId?: string;
  projectId?: string;
  status?: string;
  role?: string;
}) =>
  useQuery({
    queryKey: queryKeys.agentRuns(params),
    queryFn: () => unwrap(api.get<Paginated<AgentRunSummary>>('/agent-runs', { query: params })),
    refetchInterval: 15_000,
  });

export const useAgentRun = (id: string) =>
  useQuery({
    queryKey: queryKeys.agentRun(id),
    queryFn: () => unwrap(api.get<AgentRunDetail>(`/agent-runs/${id}`)),
    enabled: Boolean(id),
  });

export const useSetRoleAssignments = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignments: { role: string; agentId: string | null }[]) =>
      api.post(`/projects/${projectId}/role-assignments`, { assignments }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });
};

// ---------------------------------------------------------------------------
// Workflows, tests, reviews
// ---------------------------------------------------------------------------

export const useWorkflowDefinitions = () =>
  useQuery({
    queryKey: queryKeys.workflows,
    queryFn: () =>
      unwrap(api.get<{ items: unknown[]; meta: { orchestrator: string } }>('/workflows')),
  });

export const useWorkflowRuns = (params?: {
  projectId?: string;
  taskId?: string;
  status?: string;
}) =>
  useQuery({
    queryKey: queryKeys.workflowRuns(params),
    queryFn: () =>
      unwrap(api.get<Paginated<WorkflowRunSummary>>('/workflow-runs', { query: params })),
    refetchInterval: 15_000,
  });

export const useWorkflowRun = (id: string) =>
  useQuery({
    queryKey: queryKeys.workflowRun(id),
    queryFn: () => unwrap(api.get<WorkflowRunDetail>(`/workflow-runs/${id}`)),
    enabled: Boolean(id),
    refetchInterval: 5_000,
  });

export const useTestRuns = (params?: { projectId?: string }) =>
  useQuery({
    queryKey: queryKeys.testRuns(params),
    queryFn: () => unwrap(api.get<Paginated<TestRunSummary>>('/test-runs', { query: params })),
  });

export const useReviewRuns = (params?: { projectId?: string; decision?: string }) =>
  useQuery({
    queryKey: queryKeys.reviewRuns(params),
    queryFn: () => unwrap(api.get<Paginated<ReviewRunSummary>>('/review-runs', { query: params })),
  });

export const useFindings = (params?: { projectId?: string; status?: string; severity?: string }) =>
  useQuery({
    queryKey: queryKeys.findings(params),
    queryFn: () =>
      unwrap(api.get<Paginated<ReviewFindingSummary>>('/review-findings', { query: params })),
  });

/**
 * The action inbox. Polled rather than streamed: the live-event work (P3) has
 * not landed, and TanStack Query stays the canonical server-state cache when it
 * does.
 */
export const useInbox = (params?: { projectId?: string; type?: string; severity?: string }) =>
  useQuery({
    queryKey: queryKeys.inbox(params),
    queryFn: () => unwrap(api.get<{ items: InboxItem[] }>('/inbox', { query: params })),
    refetchInterval: 20_000,
  });

export const useUpdateFinding = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
      resolutionNote,
    }: {
      id: string;
      status: string;
      resolutionNote?: string;
    }) => api.patch(`/review-findings/${id}`, { status, resolutionNote }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review-findings'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
};

// ---------------------------------------------------------------------------
// Automation, quality, insights
// ---------------------------------------------------------------------------

export const useSchedules = (projectId?: string) =>
  useQuery({
    queryKey: queryKeys.schedules(projectId),
    queryFn: () =>
      unwrap(api.get<{ items: ScheduleSummary[] }>('/schedules', { query: { projectId } })),
  });

export const useScheduleMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: 'update' | 'run'; body?: unknown }) =>
      action === 'run' ? api.post(`/schedules/${id}/run`) : api.patch(`/schedules/${id}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['schedules'] }),
  });
};

export const usePullRequests = (params?: { projectId?: string; status?: string }) =>
  useQuery({
    queryKey: queryKeys.pullRequests(params),
    queryFn: () =>
      unwrap(api.get<Paginated<PullRequestSummary>>('/pull-requests', { query: params })),
  });

export const useWorktrees = () =>
  useQuery({
    queryKey: queryKeys.worktrees,
    queryFn: () => unwrap(api.get<{ items: WorktreeSummary[] }>('/worktrees')),
  });

export const useUsage = (params?: { projectId?: string; groupBy?: string }) =>
  useQuery({
    queryKey: queryKeys.usage(params),
    queryFn: () => unwrap(api.get<UsageSummary>('/usage', { query: params })),
  });

export const useCosts = (params?: { projectId?: string }) =>
  useQuery({
    queryKey: queryKeys.costs(params),
    queryFn: () => unwrap(api.get<CostSummary>('/costs', { query: params })),
  });

export const useCostsByTask = () =>
  useQuery({
    queryKey: queryKeys.costsByTask,
    queryFn: () =>
      unwrap(
        api.get<{
          items: {
            taskId: string | null;
            task: { key: string; title: string } | null;
            cost: number;
          }[];
        }>('/costs/by-task'),
      ),
  });

export const useAuditLogs = (params?: {
  projectId?: string;
  taskId?: string;
  action?: string;
  pageSize?: number;
}) =>
  useQuery({
    queryKey: queryKeys.audit(params),
    queryFn: () => unwrap(api.get<Paginated<AuditLogSummary>>('/audit-logs', { query: params })),
  });

export const useApprovals = (params?: { projectId?: string; status?: string }) =>
  useQuery({
    queryKey: queryKeys.approvals(params),
    queryFn: () => unwrap(api.get<{ items: ApprovalSummary[] }>('/approvals', { query: params })),
  });

export const useNotifications = (unreadOnly = false) =>
  useQuery({
    queryKey: queryKeys.notifications({ unreadOnly }),
    queryFn: () =>
      unwrap(
        api.get<Paginated<NotificationSummary> & { meta: { unread: number } }>('/notifications', {
          query: { unreadOnly, pageSize: 30 },
        }),
      ),
    refetchInterval: 30_000,
  });

export const useMarkNotificationsRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) =>
      id ? api.post(`/notifications/${id}/read`) : api.post('/notifications/read-all'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
};

export const useHealth = () =>
  useQuery({
    queryKey: queryKeys.health,
    queryFn: () => unwrap(api.get<Record<string, unknown>>('/health')),
    refetchInterval: 30_000,
    retry: false,
  });
