import type {
  AgentRole,
  AgentRunStatus,
  CheckStatus,
  CheckType,
  FindingStatus,
  PermissionLevel,
  Priority,
  ReviewCategory,
  ReviewDecision,
  RiskLevel,
  RunStatus,
  Severity,
  TaskStatus,
  TaskType,
  Viewport,
  WorkflowStepKey,
} from '@engloop/types';

/**
 * View models for API payloads.
 *
 * Hand-written rather than derived from Prisma so the browser bundle never
 * imports the database client, and so an API shape change surfaces as a
 * compile error here instead of `undefined` at runtime.
 */

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  key: string;
  description: string | null;
  status: string;
  permissionLevel: PermissionLevel;
  maxReviewCycles: number;
  costBudgetUsd: string | number;
  organization?: { id: string; name: string; slug: string };
  repositories?: RepositorySummary[];
  _count?: { tasks: number; epics: number; schedules: number };
}

export interface RepositorySummary {
  id: string;
  name: string;
  provider: string;
  status: string;
  defaultBranch: string;
  primaryLanguage: string | null;
  frameworks: string[];
  packageManager: string;
  remoteUrl: string | null;
  commands?: Record<string, string>;
  lastAnalyzedAt?: string | null;
  project?: { id: string; name: string; key: string };
  _count?: { tasks: number; worktrees: number; pullRequests: number; branches?: number };
}

export interface GitHubInstallationSummary {
  id: string;
  installationId: string;
  accountId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  status: string;
  suspendedAt: string | null;
  lastSyncedAt: string | null;
}

export interface GitHubRepositoryCandidate {
  id: string;
  name: string;
  fullName: string;
  description?: string | null;
  private: boolean;
  archived: boolean;
  visibility?: string;
  htmlUrl: string;
  defaultBranch: string;
  language: string | null;
  pushedAt?: string | null;
  imported: boolean;
}

export interface AgentSummary {
  id: string;
  name: string;
  role: AgentRole;
  model: string | null;
  enabled: boolean;
  projectId: string | null;
  permissionLevel: PermissionLevel;
  maxTokens: number;
  maxCostUsd: string | number;
  timeoutMs: number;
  maxRetries: number;
  allowedCommands: string[];
  provider: {
    id?: string;
    key: string;
    displayName: string;
    kind: string;
    healthy?: boolean;
    defaultModel?: string | null;
  };
  _count?: { runs: number };
}

export interface AgentProviderSummary {
  id: string;
  key: string;
  displayName: string;
  kind: string;
  enabled: boolean;
  defaultModel: string | null;
  availableModels: string[];
  healthy: boolean;
  lastHealthCheckAt: string | null;
  lastHealthDetail: string | null;
  hasCredential: boolean;
  requiresCredential?: boolean;
  /**
   * How the provider authenticates at run time: `database` uses the key stored
   * from this UI, `cli-login` falls back to the CLI's own session, and `none`
   * is a provider that never authenticates.
   */
  credentialSource?: 'none' | 'database' | 'cli-login';
  pricing?: Record<string, number>;
  _count?: { agents: number; agentRuns: number };
}

/** Partial update of an agent's execution limits (PATCH /agents/:id). */
export interface UpdateAgentInput {
  maxTokens?: number;
  maxCostUsd?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  role: string;
}

export interface UpsertProviderInput {
  organizationId: string;
  key: string;
  displayName: string;
  kind: string;
  enabled: boolean;
  defaultModel?: string;
  availableModels: string[];
  /** Sent only when the admin typed a new key; omitted leaves the stored one. */
  credential?: string;
  clearCredential?: boolean;
  configuration: Record<string, unknown>;
}

export interface TaskSummary {
  id: string;
  key: string;
  title: string;
  description: string;
  objective: string;
  type: TaskType;
  priority: Priority;
  riskLevel: RiskLevel;
  status: TaskStatus;
  severity: Severity | null;
  acceptanceCriteria: string[];
  implementationNotes: string[];
  suggestedFiles: string[];
  requiredChecks: CheckType[];
  attemptCount: number;
  maxAttempts: number;
  reviewCycle: number;
  estimatedCost: string | number;
  actualCost: string | number;
  branchName: string | null;
  worktreePath: string | null;
  blockedReason: string | null;
  planSummary: string | null;
  projectId: string;
  repositoryId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string;
  project?: { id: string; name: string; key: string; slug?: string };
  repository?: { id: string; name: string; defaultBranch?: string } | null;
  assignedAgent?: { id: string; name: string; role: AgentRole; model: string | null } | null;
  _count?: { agentRuns: number; testRuns: number; reviewRuns: number; subtasks: number };
}

export interface TaskDetail extends TaskSummary {
  allowedTransitions: TaskStatus[];
  plan: PlanPayload | null;
  epic?: { id: string; title: string } | null;
  feature?: { id: string; title: string } | null;
  createdBy?: { id: string; name: string; email: string } | null;
  dependencies: { id: string; type: string; dependsOn: TaskRef }[];
  dependents: { id: string; type: string; task: TaskRef }[];
  subtasks: TaskRef[];
  comments: TaskComment[];
  workflowRuns: WorkflowRunSummary[];
  agentRuns: AgentRunSummary[];
  testRuns: TestRunSummary[];
  reviewRuns: ReviewRunSummary[];
  pullRequests: PullRequestSummary[];
  commits: CommitSummary[];
  artifacts: ArtifactSummary[];
  worktrees: WorktreeSummary[];
  approvals: ApprovalSummary[];
}

export interface PlanPayload {
  summary: string;
  approach: string;
  risks: string[];
  acceptanceCriteria: string[];
  architectureNotes?: string[];
  openQuestions?: string[];
  tasks: { title: string; objective: string; priority: Priority; type: TaskType }[];
}

export interface TaskRef {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  priority?: Priority;
}

export interface TaskComment {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string } | null;
}

export interface AgentRunSummary {
  id: string;
  role: AgentRole;
  providerKey: string;
  model: string | null;
  status: AgentRunStatus;
  attempt: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: string | number;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  task?: { id: string; key: string; title: string; projectId?: string } | null;
  agent?: { id: string; name: string } | null;
}

export interface AgentRunDetail extends AgentRunSummary {
  input: unknown;
  output: unknown;
  rawOutput: string | null;
  messages: { id: string; role: string; content: string; sequence: number; createdAt: string }[];
  provider?: { key: string; displayName: string; kind: string } | null;
}

export interface TestResultSummary {
  id: string;
  checkType: CheckType;
  name: string;
  status: CheckStatus;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface TestRunSummary {
  id: string;
  status: CheckStatus;
  passed: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
  coverage: Record<string, number> | null;
  results: TestResultSummary[];
  task?: { id: string; key: string; title: string } | null;
}

export interface ReviewFindingSummary {
  id: string;
  severity: Severity;
  category: ReviewCategory;
  uiCategory: string | null;
  viewport: Viewport | null;
  file: string | null;
  line: number | null;
  problem: string;
  requiredFix: string;
  evidence: string | null;
  status: FindingStatus;
  resolutionNote: string | null;
  createdAt: string;
  reviewRun?: {
    id: string;
    kind: string;
    cycle: number;
    task?: { id: string; key: string; title: string } | null;
  };
}

export interface ReviewRunSummary {
  id: string;
  kind: string;
  decision: ReviewDecision;
  status: RunStatus;
  cycle: number;
  score: number;
  summary: string;
  coverageAssessment: string | null;
  architectureAssessment: string | null;
  securityAssessment: string | null;
  performanceAssessment: string | null;
  createdAt: string;
  completedAt: string | null;
  findings: ReviewFindingSummary[];
  task?: { id: string; key: string; title: string } | null;
}

export interface WorkflowStepSummary {
  id: string;
  stepKey: WorkflowStepKey;
  sequence: number;
  status: RunStatus;
  attempt: number;
  maxAttempts: number;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  agentRuns?: AgentRunSummary[];
  testRuns?: TestRunSummary[];
  reviewRuns?: ReviewRunSummary[];
}

export interface WorkflowRunSummary {
  id: string;
  definitionKey: string;
  status: RunStatus;
  currentStepKey: WorkflowStepKey | null;
  reviewCycle: number;
  attempt: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  steps: WorkflowStepSummary[];
  task?: { id: string; key: string; title: string; status?: TaskStatus } | null;
  project?: { id: string; name: string; key: string } | null;
  _count?: { agentRuns: number; testRuns: number; reviewRuns: number };
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  definition: {
    key: string;
    name: string;
    steps: {
      key: WorkflowStepKey;
      title: string;
      description: string;
      kind: string;
      role: AgentRole | null;
    }[];
  };
  progress: { completed: number; total: number; percent: number };
}

export interface PullRequestSummary {
  id: string;
  number: number | null;
  title: string;
  status: string;
  headBranch: string;
  baseBranch: string;
  url: string | null;
  local: boolean;
  createdAt: string;
  mergedAt: string | null;
  repository?: { id: string; name: string; provider: string };
  task?: { id: string; key: string; title: string; status: TaskStatus } | null;
}

export interface CommitSummary {
  id: string;
  sha: string;
  message: string;
  authorName: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  committedAt: string;
}

export interface ArtifactSummary {
  id: string;
  kind: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  content?: string | null;
  metadata?: Record<string, unknown>;
}

export interface WorktreeSummary {
  id: string;
  path: string;
  branch: string;
  baseRef: string;
  status: string;
  clean: boolean;
  createdAt: string;
  repository?: { id: string; name: string };
  task?: { id: string; key: string; title: string; status: TaskStatus } | null;
}

export interface ApprovalSummary {
  id: string;
  kind: string;
  status: string;
  reason: string | null;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  task?: { id: string; key: string; title: string; status: TaskStatus } | null;
  project?: { id: string; name: string; key: string };
}

export interface ScheduleSummary {
  id: string;
  name: string;
  type: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: RunStatus | null;
  project?: { id: string; name: string; key: string };
  repository?: { id: string; name: string } | null;
}

export interface NotificationSummary {
  id: string;
  type: string;
  title: string;
  body: string;
  severity: Severity;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface AuditLogSummary {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  actorType: string;
  taskId: string | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
  user?: { id: string; name: string; email: string } | null;
}

export interface DashboardOverview {
  cards: {
    activeProjects: number;
    tasksRunning: number;
    tasksWaitingReview: number;
    tasksBlocked: number;
    testsPassing: number;
    testsFailing: number;
    openReviewFindings: number;
    criticalFindings: number;
    spendThisMonthUsd: number;
    tasksCompletedThisWeek: number;
    agentSuccessRate: number;
    agentRunsTotal: number;
  };
  activeAgentRuns: AgentRunSummary[];
  recentActivity: AuditLogSummary[];
}

export interface DeliveryMetrics {
  completedCount: number;
  cycleTimeMs: { p50: number; p90: number; average: number };
  averageAttempts: number;
  averageCostUsd: number;
  tasksByStatus: Record<string, number>;
}

export interface UsageSummary {
  range: { from: string; to: string };
  totals: {
    runs: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    durationMs: number;
  };
  byDay: { date: string; totalTokens: number; inputTokens: number; outputTokens: number }[];
  byProvider: { providerKey: string; totalTokens: number; runs: number }[];
  byProject: { projectId: string | null; totalTokens: number; runs: number }[];
}

export interface CostSummary {
  today: number;
  thisWeek: number;
  thisMonth: number;
  budgetUsd: number;
  budgetUsedPercent: number;
  byDay: { date: string; cost: number }[];
  byProvider: { providerKey: string; cost: number; runs: number }[];
  byProject: { projectId: string | null; cost: number }[];
}

export interface AgentPerformanceRow {
  role: AgentRole;
  providerKey: string;
  total: number;
  succeeded: number;
  failed: number;
  successRate: number;
  avgDurationMs: number;
  totalTokens: number;
  totalCost: number;
}

export interface AgentTeamRow {
  role: AgentRole;
  agent: AgentSummary | null;
  candidates: AgentSummary[];
}

/** Body of `POST /tasks`; the API fills in the defaults (see `createTaskSchema`). */
export interface CreateTaskInput {
  projectId: string;
  repositoryId?: string;
  title: string;
  objective?: string;
  description?: string;
  type?: TaskType;
  priority?: Priority;
  riskLevel?: RiskLevel;
  acceptanceCriteria?: string[];
  requiredChecks?: CheckType[];
  maxAttempts?: number;
}

export interface Paginated<T> {
  items: T[];
  meta: { pagination?: { page: number; pageSize: number; total: number; totalPages: number } };
}

/**
 * One decision awaiting a person, derived from the record that owns the state.
 * Mirrors `inboxItemSchema` in `@engloop/schemas`.
 */
export interface InboxItem {
  type: 'APPROVAL' | 'HUMAN_REVIEW' | 'WORKFLOW_FAILURE' | 'BLOCKING_FINDING';
  sourceId: string;
  projectId: string;
  projectName: string;
  severity: Severity;
  title: string;
  detail: string | null;
  taskKey: string | null;
  firstSeenAt: string;
  deepLink: string;
}
