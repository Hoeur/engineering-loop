import {
  AgentRole,
  CheckType,
  PermissionLevel,
  Priority,
  RiskLevel,
  TaskStatus,
  TaskType,
} from '@engloop/types';
import type { AgentTaskContext, ImplementationInput, ReviewInput } from '@engloop/schemas';

let counter = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++counter).padStart(6, '0')}`;

export const resetFactoryCounter = (): void => {
  counter = 0;
};

export interface TaskFixture {
  id: string;
  key: string;
  title: string;
  objective: string;
  description: string;
  type: TaskType;
  priority: Priority;
  riskLevel: RiskLevel;
  status: TaskStatus;
  acceptanceCriteria: string[];
  requiredChecks: CheckType[];
  maxAttempts: number;
  attemptCount: number;
}

export const makeTask = (overrides: Partial<TaskFixture> = {}): TaskFixture => ({
  id: nextId('task'),
  key: 'ENG-101',
  title: 'Implement organization invitations',
  objective: 'Allow owners to invite teammates by email.',
  description: 'Adds the invitation entity, endpoints and UI.',
  type: TaskType.FEATURE,
  priority: Priority.HIGH,
  riskLevel: RiskLevel.MEDIUM,
  status: TaskStatus.BACKLOG,
  acceptanceCriteria: ['An owner can invite by email.', 'Invitations expire after 7 days.'],
  requiredChecks: [CheckType.LINT, CheckType.TYPECHECK, CheckType.UNIT, CheckType.BUILD],
  maxAttempts: 3,
  attemptCount: 0,
  ...overrides,
});

export const makeAgentTaskContext = (
  overrides: Partial<AgentTaskContext> = {},
): AgentTaskContext => ({
  runId: nextId('run'),
  role: AgentRole.PLANNER,
  project: {
    id: nextId('project'),
    name: 'EngLoop',
    slug: 'engloop',
    description: 'Multi-agent engineering orchestration platform',
    permissionLevel: PermissionLevel.LEVEL_3_PR,
  },
  repository: {
    id: nextId('repo'),
    name: 'engloop-api',
    provider: 'LOCAL',
    defaultBranch: 'main',
    primaryLanguage: 'TypeScript',
    frameworks: ['NestJS'],
    packageManager: 'pnpm',
    rootPath: '/workspace/repositories/engloop-api',
    fileCount: 420,
  },
  memory: {
    architecture: null,
    techStack: ['NestJS', 'Prisma', 'PostgreSQL'],
    conventions: [],
    apiConventions: [],
    uiConventions: [],
    testCommands: {},
    knownTechDebt: [],
    knownBugs: [],
    completedFeatures: [],
    importantModules: [],
    decisions: [],
  },
  guidance: { files: {}, truncated: [] },
  budget: {
    timeoutMs: 900_000,
    maxTokens: 200_000,
    maxCostUsd: 5,
    allowedCommands: ['pnpm', 'git'],
  },
  workspacePath: '/workspace/worktrees/ENG-101',
  branchName: 'agent/ENG-101-organization-invitations',
  input: { requirement: 'Implement organization invitations' },
  correlation: { traceId: nextId('trace') },
  ...overrides,
});

export const makeImplementationInput = (
  overrides: Partial<ImplementationInput> = {},
): ImplementationInput => ({
  taskId: nextId('task'),
  taskKey: 'ENG-101',
  title: 'Implement organization invitations',
  objective: 'Allow owners to invite teammates by email.',
  description: '',
  acceptanceCriteria: ['An owner can invite by email.'],
  implementationNotes: [],
  suggestedFiles: ['src/invitations/invitations.service.ts'],
  requiredChecks: [CheckType.LINT, CheckType.UNIT],
  fixFindings: [],
  failedChecks: [],
  attempt: 1,
  ...overrides,
});

export const makeReviewInput = (overrides: Partial<ReviewInput> = {}): ReviewInput => ({
  taskId: nextId('task'),
  taskKey: 'ENG-101',
  title: 'Implement organization invitations',
  objective: 'Allow owners to invite teammates by email.',
  acceptanceCriteria: [],
  plannerSummary: null,
  implementationSummary: null,
  diff: '',
  diffTruncated: false,
  changedFiles: [],
  testResults: [],
  coverage: null,
  cycle: 1,
  maxCycles: 3,
  ...overrides,
});
