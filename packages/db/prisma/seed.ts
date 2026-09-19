import { randomBytes, scryptSync } from 'node:crypto';
import path from 'node:path';

import { Prisma } from '@prisma/client';
import { config as loadEnv } from 'dotenv';

import { createPrismaClient } from '../src/client';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });
loadEnv({ path: path.join(__dirname, '..', '.env'), override: true, quiet: true });

const prisma = createPrismaClient();

/**
 * Which provider the seeded organization and agent team run on.
 *
 * Defaults to the offline mock so a fresh clone needs no credentials, but
 * `AGENT_DEFAULT_PROVIDER=claude-code pnpm db:seed` gives you a team wired to a
 * real CLI. Without this the env var was effectively dead for a seeded database:
 * the agent rows pinned every role to the mock and won the resolution chain.
 */
const DEFAULT_PROVIDER_KEY = process.env.AGENT_DEFAULT_PROVIDER ?? 'mock';

const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
};

const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
};

const hoursAgo = (hours: number): Date => new Date(Date.now() - hours * 3_600_000);

const dateOnly = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

async function main(): Promise<void> {
  console.log('› Seeding EngLoop demo data …');

  // ---------------------------------------------------------------------
  // Clean slate. Order matters: children before parents.
  // ---------------------------------------------------------------------
  await prisma.$transaction([
    prisma.reviewFinding.deleteMany(),
    prisma.screenshot.deleteMany(),
    prisma.reviewRun.deleteMany(),
    prisma.testResult.deleteMany(),
    prisma.testRun.deleteMany(),
    prisma.agentMessage.deleteMany(),
    prisma.artifact.deleteMany(),
    prisma.usageRecord.deleteMany(),
    prisma.costRecord.deleteMany(),
    prisma.agentRun.deleteMany(),
    prisma.workflowStep.deleteMany(),
    prisma.workflowRun.deleteMany(),
    prisma.workflowDefinition.deleteMany(),
    prisma.approval.deleteMany(),
    prisma.taskComment.deleteMany(),
    prisma.taskDependency.deleteMany(),
    prisma.pullRequest.deleteMany(),
    prisma.commit.deleteMany(),
    prisma.gitBranch.deleteMany(),
    prisma.gitWorktree.deleteMany(),
    prisma.task.deleteMany(),
    prisma.feature.deleteMany(),
    prisma.epic.deleteMany(),
    prisma.schedule.deleteMany(),
    prisma.projectMemory.deleteMany(),
    prisma.architectureDecision.deleteMany(),
    prisma.repositoryCredential.deleteMany(),
    prisma.repository.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.agentConfiguration.deleteMany(),
    prisma.agent.deleteMany(),
    prisma.agentProvider.deleteMany(),
    prisma.project.deleteMany(),
    prisma.organizationMember.deleteMany(),
    prisma.organization.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  // ---------------------------------------------------------------------
  // Organization and people
  // ---------------------------------------------------------------------
  const organization = await prisma.organization.create({
    data: {
      name: 'Evalley',
      slug: 'evalley',
      defaultProviderKey: DEFAULT_PROVIDER_KEY,
      costBudgetUsd: new Prisma.Decimal(500),
    },
  });

  const founder = await prisma.user.create({
    data: {
      email: 'founder@evalley.dev',
      name: 'Hour Lihour',
      passwordHash: hashPassword('engloop-dev-password'),
      memberships: { create: { organizationId: organization.id, role: 'OWNER' } },
    },
  });

  const engineer = await prisma.user.create({
    data: {
      email: 'engineer@evalley.dev',
      name: 'Dara Sok',
      passwordHash: hashPassword('engloop-dev-password'),
      memberships: { create: { organizationId: organization.id, role: 'MAINTAINER' } },
    },
  });

  // ---------------------------------------------------------------------
  // Agent providers and the agent team
  // ---------------------------------------------------------------------
  const mockProvider = await prisma.agentProvider.create({
    data: {
      organizationId: organization.id,
      key: 'mock',
      displayName: 'Mock Agent',
      kind: 'MOCK',
      enabled: true,
      defaultModel: 'mock',
      availableModels: ['mock'],
      healthy: true,
      lastHealthCheckAt: new Date(),
      lastHealthDetail: 'Mock provider is always available; no credentials required.',
      pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0, cachedPerMillionUsd: 0 },
    },
  });

  const codexProvider = await prisma.agentProvider.create({
    data: {
      organizationId: organization.id,
      key: 'codex',
      displayName: 'Codex',
      kind: 'CODEX',
      enabled: DEFAULT_PROVIDER_KEY === 'codex',
      defaultModel: process.env.CODEX_MODEL ?? 'gpt-5-codex',
      availableModels: ['gpt-5-codex'],
      healthy: false,
      lastHealthDetail: 'No credential configured — adapter registered but not selectable.',
      pricing: { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10, cachedPerMillionUsd: 0.125 },
    },
  });

  const claudeCodeProvider = await prisma.agentProvider.create({
    data: {
      organizationId: organization.id,
      key: 'claude-code',
      displayName: 'Claude Code',
      kind: 'CLAUDE_CODE',
      enabled: DEFAULT_PROVIDER_KEY === 'claude-code',
      defaultModel: process.env.CLAUDE_CODE_MODEL ?? 'sonnet',
      availableModels: ['sonnet', 'opus', 'haiku'],
      healthy: false,
      lastHealthDetail: 'No credential configured — adapter registered but not selectable.',
      pricing: { inputPerMillionUsd: 5, outputPerMillionUsd: 25, cachedPerMillionUsd: 0.5 },
    },
  });

  // The team binds to whichever provider AGENT_DEFAULT_PROVIDER names, so a
  // seeded database matches the environment the worker is running with. Pixel
  // stays on the mock: UI review needs screenshots no CLI agent can produce yet.
  const providersByKey = {
    mock: mockProvider,
    codex: codexProvider,
    'claude-code': claudeCodeProvider,
  } as const;

  const teamProvider =
    providersByKey[DEFAULT_PROVIDER_KEY as keyof typeof providersByKey] ?? mockProvider;

  const agentSpecs: {
    name: string;
    role: Prisma.AgentCreateInput['role'];
    permissionLevel: Prisma.AgentCreateInput['permissionLevel'];
    maxCostUsd: number;
  }[] = [
    { name: 'Atlas', role: 'ARCHITECT', permissionLevel: 'LEVEL_1_PLAN', maxCostUsd: 2 },
    { name: 'Cartographer', role: 'PLANNER', permissionLevel: 'LEVEL_1_PLAN', maxCostUsd: 3 },
    { name: 'Forge', role: 'IMPLEMENTER', permissionLevel: 'LEVEL_3_PR', maxCostUsd: 8 },
    { name: 'Sentinel', role: 'CODE_REVIEWER', permissionLevel: 'LEVEL_1_PLAN', maxCostUsd: 4 },
    { name: 'Bastion', role: 'SECURITY_REVIEWER', permissionLevel: 'LEVEL_1_PLAN', maxCostUsd: 3 },
    { name: 'Pixel', role: 'UI_REVIEWER', permissionLevel: 'LEVEL_1_PLAN', maxCostUsd: 3 },
    { name: 'Probe', role: 'QA', permissionLevel: 'LEVEL_2_CODE', maxCostUsd: 3 },
  ];

  const agents = await Promise.all(
    agentSpecs.map((spec) =>
      prisma.agent.create({
        data: {
          organizationId: organization.id,
          providerId: spec.role === 'UI_REVIEWER' ? mockProvider.id : teamProvider.id,
          name: spec.name,
          role: spec.role,
          model:
            spec.role === 'UI_REVIEWER'
              ? 'mock'
              : (teamProvider.defaultModel ?? DEFAULT_PROVIDER_KEY),
          enabled: true,
          permissionLevel: spec.permissionLevel,
          maxCostUsd: new Prisma.Decimal(spec.maxCostUsd),
          allowedCommands: ['pnpm', 'git', 'node'],
          configurations: { create: { version: 1, values: { temperature: 0.2 }, active: true } },
        },
      }),
    ),
  );

  const agentByRole = new Map(agents.map((agent) => [agent.role, agent]));

  // ---------------------------------------------------------------------
  // Projects and repositories
  // ---------------------------------------------------------------------
  const engloop = await prisma.project.create({
    data: {
      organizationId: organization.id,
      name: 'EngLoop',
      slug: 'engloop',
      key: 'ENG',
      description: 'The multi-agent engineering orchestration platform itself.',
      permissionLevel: 'LEVEL_3_PR',
      maxReviewCycles: 3,
      maxTaskAttempts: 3,
      costBudgetUsd: new Prisma.Decimal(120),
      taskSequence: 100,
      roleAssignments: {
        ARCHITECT: agentByRole.get('ARCHITECT')?.id,
        PLANNER: agentByRole.get('PLANNER')?.id,
        IMPLEMENTER: agentByRole.get('IMPLEMENTER')?.id,
        CODE_REVIEWER: agentByRole.get('CODE_REVIEWER')?.id,
      } as Prisma.InputJsonValue,
    },
  });

  const erp = await prisma.project.create({
    data: {
      organizationId: organization.id,
      name: 'ERP Platform',
      slug: 'erp-platform',
      key: 'ERP',
      description: 'Internal ERP: inventory, procurement and finance.',
      permissionLevel: 'LEVEL_2_CODE',
      costBudgetUsd: new Prisma.Decimal(80),
      taskSequence: 200,
    },
  });

  const chatgate = await prisma.project.create({
    data: {
      organizationId: organization.id,
      name: 'ChatGate',
      slug: 'chatgate',
      key: 'CHAT',
      description: 'Realtime chat product built on NestJS and Socket.io.',
      permissionLevel: 'LEVEL_1_PLAN',
      costBudgetUsd: new Prisma.Decimal(60),
      taskSequence: 300,
    },
  });

  const engloopWeb = await prisma.repository.create({
    data: {
      projectId: engloop.id,
      name: 'engloop-web',
      provider: 'LOCAL',
      defaultBranch: 'main',
      primaryLanguage: 'TypeScript',
      frameworks: ['Next.js', 'React', 'Tailwind CSS'],
      packageManager: 'pnpm',
      commands: {
        lint: 'pnpm lint',
        typecheck: 'pnpm typecheck',
        unit: 'pnpm test',
        build: 'pnpm build',
        e2e: 'pnpm test:e2e',
      },
      lastSyncedAt: hoursAgo(3),
      lastAnalyzedAt: hoursAgo(3),
    },
  });

  const engloopApi = await prisma.repository.create({
    data: {
      projectId: engloop.id,
      name: 'engloop-api',
      provider: 'LOCAL',
      defaultBranch: 'main',
      primaryLanguage: 'TypeScript',
      frameworks: ['NestJS', 'Prisma'],
      packageManager: 'pnpm',
      commands: {
        lint: 'pnpm lint',
        typecheck: 'pnpm typecheck',
        unit: 'pnpm test',
        build: 'pnpm build',
      },
      lastSyncedAt: hoursAgo(2),
      lastAnalyzedAt: hoursAgo(2),
    },
  });

  const evalleyErp = await prisma.repository.create({
    data: {
      projectId: erp.id,
      name: 'evalley-erp',
      provider: 'LOCAL',
      defaultBranch: 'main',
      primaryLanguage: 'TypeScript',
      frameworks: ['NestJS', 'Vue'],
      packageManager: 'pnpm',
      commands: { lint: 'pnpm lint', typecheck: 'pnpm typecheck', unit: 'pnpm test' },
    },
  });

  const chatgateCore = await prisma.repository.create({
    data: {
      projectId: chatgate.id,
      name: 'chatgate-core',
      provider: 'LOCAL',
      defaultBranch: 'main',
      primaryLanguage: 'TypeScript',
      frameworks: ['NestJS', 'Socket.io'],
      packageManager: 'pnpm',
      commands: { lint: 'pnpm lint', typecheck: 'pnpm typecheck', unit: 'pnpm test' },
    },
  });

  // ---------------------------------------------------------------------
  // Project memory and ADRs
  // ---------------------------------------------------------------------
  await prisma.projectMemory.createMany({
    data: [
      {
        projectId: engloop.id,
        kind: 'ARCHITECTURE',
        content:
          'pnpm monorepo. apps/web (Next.js App Router), apps/api (NestJS REST), apps/worker (BullMQ). Shared packages own domain types, Zod schemas, the workflow state machine, the git abstraction and the agent SDK.',
      },
      {
        projectId: engloop.id,
        kind: 'TECH_STACK',
        content:
          '- Next.js 15 / React 19\n- NestJS 11\n- Prisma 6 + PostgreSQL 16\n- BullMQ 5 + Redis 7\n- Zod for every trust boundary',
      },
      {
        projectId: engloop.id,
        kind: 'CONVENTIONS',
        content:
          '- No business logic in controllers\n- Every enum lives in @engloop/types\n- Task status is written only by the state machine\n- Never trust raw agent output; validate with Zod',
      },
      {
        projectId: engloop.id,
        kind: 'API_CONVENTIONS',
        content:
          '- All responses use { success, data, meta } / { success, error, meta }\n- Validation errors return 422 VALIDATION_FAILED\n- Illegal state moves return 409 TASK_INVALID_TRANSITION',
      },
      {
        projectId: engloop.id,
        kind: 'UI_CONVENTIONS',
        content:
          '- Light mode is primary, dark mode supported\n- Every screen ships loading, empty and error states\n- Tables collapse to cards below md',
      },
      {
        projectId: engloop.id,
        kind: 'TECH_DEBT',
        content:
          '- GitHub App authentication is a placeholder\n- UI QA screenshots are mocked\n- Auth is a dev-grade JWT, not a real IdP',
      },
      {
        projectId: engloop.id,
        kind: 'TEST_COMMANDS',
        content: 'lint: pnpm lint\ntypecheck: pnpm typecheck\nunit: pnpm test\nbuild: pnpm build',
      },
    ],
  });

  await prisma.architectureDecision.createMany({
    data: [
      {
        projectId: engloop.id,
        number: 1,
        title: 'Use a provider-independent agent interface',
        context:
          'The platform must coordinate Codex, Claude Code and future agents without business logic depending on any of them.',
        decision:
          'Define CodingAgentProvider in @engloop/agent-sdk and resolve role → provider from configuration at runtime.',
        alternatives: [
          'Call each vendor CLI directly from the workflow steps',
          'A single LLM gateway service in front of every provider',
        ],
        consequences: [
          'Adding a provider is a new adapter plus a database row',
          'Every provider must be able to produce schema-valid structured output',
        ],
        status: 'ACCEPTED',
        authorId: founder.id,
      },
      {
        projectId: engloop.id,
        number: 2,
        title: 'Verification is deterministic and system-owned',
        context:
          'An agent reporting "all tests pass" is a claim, not evidence. Trusting it would let broken code reach a pull request.',
        decision:
          'EngLoop runs lint, typecheck, tests and build itself through an allowlisted command runner and derives pass/fail from real exit codes.',
        alternatives: ['Trust the implementation agent', 'Run checks only in CI after the PR'],
        consequences: [
          'Workers need a real checkout and toolchain',
          'Check results are auditable and reproducible',
        ],
        status: 'ACCEPTED',
        authorId: founder.id,
      },
      {
        projectId: engloop.id,
        number: 3,
        title: 'Keep the orchestrator behind a port so Temporal can replace BullMQ',
        context:
          'BullMQ is the pragmatic choice today, but long-running human-in-the-loop workflows are Temporal territory.',
        decision:
          'All domain logic depends on the WorkflowOrchestrator interface; BullMQ is one adapter in apps/worker.',
        alternatives: ['Adopt Temporal now', 'Couple the engine to BullMQ directly'],
        consequences: [
          'A small amount of indirection today',
          'Migration becomes one adapter, not a rewrite',
        ],
        status: 'ACCEPTED',
        authorId: engineer.id,
      },
    ],
  });

  // ---------------------------------------------------------------------
  // Epics and features
  // ---------------------------------------------------------------------
  const platformEpic = await prisma.epic.create({
    data: {
      projectId: engloop.id,
      title: 'Control-plane foundations',
      description: 'Everything needed for the first real multi-agent engineering loop.',
      status: 'IN_PROGRESS',
      targetDate: daysAgo(-21),
    },
  });

  const qualityEpic = await prisma.epic.create({
    data: {
      projectId: engloop.id,
      title: 'Quality and safety',
      description: 'Deterministic verification, review findings and human approval gates.',
      status: 'IN_PROGRESS',
    },
  });

  const orgFeature = await prisma.feature.create({
    data: {
      projectId: engloop.id,
      epicId: platformEpic.id,
      title: 'Organization management',
      status: 'IN_PROGRESS',
    },
  });

  const agentFeature = await prisma.feature.create({
    data: {
      projectId: engloop.id,
      epicId: platformEpic.id,
      title: 'Agent orchestration',
      status: 'IN_PROGRESS',
    },
  });

  await prisma.feature.create({
    data: {
      projectId: engloop.id,
      epicId: qualityEpic.id,
      title: 'Responsive dashboard',
      status: 'PLANNED',
    },
  });

  console.log('  ✓ organization, projects, repositories, agents');

  // ---------------------------------------------------------------------
  // Tasks — one per interesting board state (spec section 34)
  // ---------------------------------------------------------------------
  const implementer = agentByRole.get('IMPLEMENTER');
  const reviewer = agentByRole.get('CODE_REVIEWER');
  const planner = agentByRole.get('PLANNER');

  const eng101 = await prisma.task.create({
    data: {
      projectId: engloop.id,
      repositoryId: engloopApi.id,
      epicId: platformEpic.id,
      featureId: orgFeature.id,
      key: 'ENG-101',
      title: 'Implement organization invitations',
      objective: 'Let an owner invite teammates by email and have them join the organization.',
      description:
        'Add an Invitation entity, the endpoints to create/accept/revoke an invitation, and the settings UI. Invitations expire after 7 days.',
      type: 'FEATURE',
      priority: 'HIGH',
      riskLevel: 'MEDIUM',
      status: 'REVIEWING',
      acceptanceCriteria: [
        'An owner can invite a teammate by email address.',
        'An invitation expires 7 days after it is created.',
        'Accepting an invitation creates an OrganizationMember row.',
        'Revoking an invitation makes the link unusable.',
      ],
      implementationNotes: [
        'Reuse the existing OrganizationMember model.',
        'Invitation tokens must be single-use and hashed at rest.',
      ],
      suggestedFiles: [
        'apps/api/src/modules/organizations/invitations.service.ts',
        'packages/db/prisma/schema.prisma',
      ],
      requiredChecks: ['LINT', 'TYPECHECK', 'UNIT', 'BUILD'],
      assignedAgentId: implementer?.id,
      branchName: 'agent/ENG-101-implement-organization-invitations',
      worktreePath: './workspace/worktrees/ENG-101',
      attemptCount: 1,
      reviewCycle: 1,
      maxAttempts: 3,
      estimatedCost: new Prisma.Decimal(0.42),
      actualCost: new Prisma.Decimal(0.3874),
      planSummary: 'Deliver invitations in three reviewable increments: model, API, UI.',
      createdById: founder.id,
      createdAt: daysAgo(3),
      startedAt: daysAgo(1),
      lastActivityAt: hoursAgo(1),
    },
  });

  const eng102 = await prisma.task.create({
    data: {
      projectId: engloop.id,
      repositoryId: engloopApi.id,
      epicId: platformEpic.id,
      featureId: agentFeature.id,
      key: 'ENG-102',
      title: 'Add agent provider abstraction',
      objective: 'Decouple business logic from any specific coding agent vendor.',
      description:
        'Introduce CodingAgentProvider, a registry with role→provider resolution, and adapters for Codex, Claude Code and a mock.',
      type: 'REFACTOR',
      priority: 'CRITICAL',
      riskLevel: 'HIGH',
      status: 'COMPLETED',
      acceptanceCriteria: [
        'No module outside packages/agent-sdk/providers names a vendor.',
        'A mock provider can serve every agent role.',
        'Role→provider mapping is configurable per project.',
      ],
      requiredChecks: ['LINT', 'TYPECHECK', 'UNIT', 'BUILD'],
      assignedAgentId: implementer?.id,
      branchName: 'agent/ENG-102-add-agent-provider-abstraction',
      attemptCount: 2,
      reviewCycle: 2,
      estimatedCost: new Prisma.Decimal(0.6),
      actualCost: new Prisma.Decimal(0.7412),
      createdById: founder.id,
      createdAt: daysAgo(9),
      startedAt: daysAgo(8),
      completedAt: daysAgo(6),
      lastActivityAt: daysAgo(6),
    },
  });

  const eng103 = await prisma.task.create({
    data: {
      projectId: engloop.id,
      repositoryId: engloopApi.id,
      epicId: qualityEpic.id,
      key: 'ENG-103',
      title: 'Create workflow retry handling',
      objective: 'Bound the review loop and escalate to a human instead of retrying forever.',
      description:
        'Track review cycles and attempts on the workflow run; after the configured maximum, move the task to NEEDS_HUMAN_REVIEW and open an approval.',
      type: 'FEATURE',
      priority: 'HIGH',
      riskLevel: 'HIGH',
      status: 'TEST_FAILED',
      acceptanceCriteria: [
        'A run never exceeds maxReviewCycles review passes.',
        'Exhausting the loop moves the task to NEEDS_HUMAN_REVIEW.',
        'An approval row is created when the loop is exhausted.',
      ],
      requiredChecks: ['LINT', 'TYPECHECK', 'UNIT'],
      assignedAgentId: implementer?.id,
      branchName: 'agent/ENG-103-create-workflow-retry-handling',
      worktreePath: './workspace/worktrees/ENG-103',
      attemptCount: 2,
      maxAttempts: 3,
      estimatedCost: new Prisma.Decimal(0.35),
      actualCost: new Prisma.Decimal(0.5121),
      createdById: engineer.id,
      createdAt: daysAgo(4),
      startedAt: daysAgo(2),
      lastActivityAt: hoursAgo(4),
    },
  });

  const eng104 = await prisma.task.create({
    data: {
      projectId: engloop.id,
      repositoryId: engloopWeb.id,
      epicId: qualityEpic.id,
      key: 'ENG-104',
      title: 'Improve mobile sidebar responsiveness',
      objective: 'The navigation must be usable at 375px with no horizontal overflow.',
      description:
        'Convert the sidebar into a drawer below the md breakpoint, keep the collapse state on tablet, and make the task table collapse into cards.',
      type: 'UI',
      priority: 'MEDIUM',
      riskLevel: 'LOW',
      status: 'IMPLEMENTING',
      acceptanceCriteria: [
        'No horizontal overflow at 375, 390, 430, 768, 1024 and 1440px.',
        'The sidebar becomes a drawer below md.',
        'Tables render as cards on small screens.',
      ],
      requiredChecks: ['LINT', 'TYPECHECK', 'BUILD'],
      assignedAgentId: implementer?.id,
      branchName: 'agent/ENG-104-improve-mobile-sidebar-responsiveness',
      worktreePath: './workspace/worktrees/ENG-104',
      attemptCount: 1,
      estimatedCost: new Prisma.Decimal(0.28),
      actualCost: new Prisma.Decimal(0.1902),
      createdById: engineer.id,
      createdAt: daysAgo(2),
      startedAt: hoursAgo(2),
      lastActivityAt: hoursAgo(0.2),
    },
  });

  const eng105 = await prisma.task.create({
    data: {
      projectId: engloop.id,
      repositoryId: engloopApi.id,
      epicId: qualityEpic.id,
      key: 'ENG-105',
      title: 'Add security audit command',
      objective: 'Run a dependency and secret scan as a first-class check type.',
      description:
        'Add a SECURITY check that runs the repository-configured audit command and records findings as review findings.',
      type: 'SECURITY',
      priority: 'HIGH',
      riskLevel: 'MEDIUM',
      status: 'NEEDS_HUMAN_REVIEW',
      acceptanceCriteria: [
        'A SECURITY check can be configured per repository.',
        'Audit output is stored on the TestResult row.',
      ],
      requiredChecks: ['LINT', 'TYPECHECK', 'SECURITY'],
      assignedAgentId: implementer?.id,
      branchName: 'agent/ENG-105-add-security-audit-command',
      worktreePath: './workspace/worktrees/ENG-105',
      attemptCount: 3,
      maxAttempts: 3,
      reviewCycle: 3,
      estimatedCost: new Prisma.Decimal(0.5),
      actualCost: new Prisma.Decimal(1.0834),
      blockedReason: 'Exhausted 3/3 review cycles without a clean pass.',
      createdById: founder.id,
      createdAt: daysAgo(6),
      startedAt: daysAgo(5),
      lastActivityAt: hoursAgo(9),
    },
  });

  await prisma.task.create({
    data: {
      projectId: engloop.id,
      repositoryId: engloopWeb.id,
      key: 'ENG-106',
      title: 'Command palette for fast navigation',
      objective: 'Add a ⌘K palette that jumps to any project, task or screen.',
      description: 'Client-side fuzzy search over the loaded task and project lists.',
      type: 'FEATURE',
      priority: 'LOW',
      riskLevel: 'LOW',
      status: 'BACKLOG',
      requiredChecks: ['LINT', 'TYPECHECK'],
      createdById: engineer.id,
      createdAt: daysAgo(1),
      lastActivityAt: daysAgo(1),
    },
  });

  await prisma.task.create({
    data: {
      projectId: engloop.id,
      repositoryId: engloopApi.id,
      key: 'ENG-107',
      title: 'Wire real GitHub App authentication',
      objective: 'Replace the placeholder installation flow with a real GitHub App.',
      description: 'Blocked until the GitHub App is registered and its private key is provisioned.',
      type: 'DEVOPS',
      priority: 'MEDIUM',
      riskLevel: 'MEDIUM',
      status: 'BLOCKED',
      blockedReason: 'Waiting on GitHub App registration and credentials.',
      requiredChecks: ['LINT', 'TYPECHECK'],
      createdById: founder.id,
      createdAt: daysAgo(7),
      lastActivityAt: daysAgo(3),
    },
  });

  const eng108 = await prisma.task.create({
    data: {
      projectId: engloop.id,
      repositoryId: engloopApi.id,
      key: 'ENG-108',
      title: 'Persist agent message traces',
      objective: 'Store per-run agent messages so a run can be replayed in the UI.',
      description: 'Planner output for this increment is ready; implementation has not started.',
      type: 'FEATURE',
      priority: 'MEDIUM',
      riskLevel: 'LOW',
      status: 'PLAN_READY',
      acceptanceCriteria: [
        'Each agent run stores its ordered messages.',
        'The run detail screen renders the trace.',
      ],
      requiredChecks: ['LINT', 'TYPECHECK', 'UNIT'],
      planSummary: 'Add AgentMessage rows on run completion and render them in the run drawer.',
      createdById: engineer.id,
      createdAt: daysAgo(2),
      lastActivityAt: hoursAgo(20),
    },
  });

  const erp201 = await prisma.task.create({
    data: {
      projectId: erp.id,
      repositoryId: evalleyErp.id,
      key: 'ERP-201',
      title: 'Stock adjustment audit trail',
      objective: 'Record who changed stock levels, when, and why.',
      description: 'Every adjustment must be attributable and reversible.',
      type: 'FEATURE',
      priority: 'HIGH',
      riskLevel: 'MEDIUM',
      status: 'QUEUED',
      requiredChecks: ['LINT', 'TYPECHECK', 'UNIT'],
      createdById: founder.id,
      createdAt: daysAgo(2),
      lastActivityAt: hoursAgo(6),
    },
  });

  const chat301 = await prisma.task.create({
    data: {
      projectId: chatgate.id,
      repositoryId: chatgateCore.id,
      key: 'CHAT-301',
      title: 'Reconnect backoff for dropped sockets',
      objective: 'Stop hammering the gateway when a client loses its connection.',
      description: 'Exponential backoff with jitter, capped at 30 seconds.',
      type: 'BUG',
      priority: 'CRITICAL',
      severity: 'HIGH',
      riskLevel: 'HIGH',
      status: 'PLANNING',
      requiredChecks: ['LINT', 'TYPECHECK', 'UNIT'],
      assignedAgentId: planner?.id,
      createdById: engineer.id,
      createdAt: daysAgo(1),
      startedAt: hoursAgo(1),
      lastActivityAt: hoursAgo(0.5),
    },
  });

  await prisma.taskDependency.createMany({
    data: [
      { taskId: eng101.id, dependsOnTaskId: eng102.id, type: 'BLOCKS' },
      { taskId: eng105.id, dependsOnTaskId: eng103.id, type: 'RELATES_TO' },
      { taskId: eng108.id, dependsOnTaskId: eng102.id, type: 'BLOCKS' },
    ],
  });

  await prisma.taskComment.createMany({
    data: [
      {
        taskId: eng101.id,
        authorId: founder.id,
        body: 'Please make sure the invitation token is hashed at rest, not just random.',
        createdAt: daysAgo(1),
      },
      {
        taskId: eng103.id,
        authorId: engineer.id,
        body: 'The unit suite is failing on the cycle-counter assertion — see the latest run.',
        createdAt: hoursAgo(5),
      },
      {
        taskId: eng105.id,
        authorId: founder.id,
        body: 'Escalated to me after three cycles. I will pair on the audit parser.',
        createdAt: hoursAgo(8),
      },
    ],
  });

  console.log('  ✓ epics, features, tasks, dependencies');

  // ---------------------------------------------------------------------
  // Git state
  // ---------------------------------------------------------------------
  const eng101Branch = await prisma.gitBranch.create({
    data: {
      repositoryId: engloopApi.id,
      name: eng101.branchName ?? 'agent/ENG-101',
      baseBranch: 'main',
      headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      ahead: 3,
      pushed: false,
    },
  });

  await prisma.gitWorktree.createMany({
    data: [
      {
        repositoryId: engloopApi.id,
        taskId: eng101.id,
        path: './workspace/worktrees/ENG-101',
        branch: eng101.branchName ?? 'agent/ENG-101',
        baseRef: 'main',
        status: 'ACTIVE',
        clean: true,
      },
      {
        repositoryId: engloopApi.id,
        taskId: eng103.id,
        path: './workspace/worktrees/ENG-103',
        branch: eng103.branchName ?? 'agent/ENG-103',
        baseRef: 'main',
        status: 'DIRTY',
        clean: false,
      },
      {
        repositoryId: engloopWeb.id,
        taskId: eng104.id,
        path: './workspace/worktrees/ENG-104',
        branch: eng104.branchName ?? 'agent/ENG-104',
        baseRef: 'main',
        status: 'ACTIVE',
        clean: true,
      },
    ],
  });

  await prisma.commit.createMany({
    data: [
      {
        repositoryId: engloopApi.id,
        branchId: eng101Branch.id,
        taskId: eng101.id,
        sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
        message: 'ENG-101: add invitation model and migration',
        authorName: 'EngLoop Agent',
        authorEmail: 'agents@engloop.dev',
        filesChanged: 4,
        additions: 186,
        deletions: 12,
        committedAt: hoursAgo(6),
      },
      {
        repositoryId: engloopApi.id,
        branchId: eng101Branch.id,
        taskId: eng101.id,
        sha: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890',
        message: 'ENG-101: expose invitation endpoints',
        authorName: 'EngLoop Agent',
        authorEmail: 'agents@engloop.dev',
        filesChanged: 6,
        additions: 240,
        deletions: 8,
        committedAt: hoursAgo(3),
      },
    ],
  });

  await prisma.pullRequest.create({
    data: {
      repositoryId: engloopApi.id,
      taskId: eng102.id,
      number: 42,
      title: 'ENG-102: Add agent provider abstraction',
      body: 'Introduces CodingAgentProvider, the registry and the mock adapter.',
      status: 'MERGED',
      headBranch: eng102.branchName ?? 'agent/ENG-102',
      baseBranch: 'main',
      local: true,
      mergedAt: daysAgo(6),
      createdAt: daysAgo(7),
    },
  });

  // ---------------------------------------------------------------------
  // Workflow runs, agent runs, checks and reviews
  // ---------------------------------------------------------------------
  const workflowDefinition = await prisma.workflowDefinition.create({
    data: {
      key: 'engineering-task',
      version: 1,
      name: 'EngineeringTaskWorkflow',
      description:
        'Plan → implement → verify → review → fix → approve → pull request, with a bounded review loop.',
      steps: [
        'ANALYZE_REPOSITORY',
        'PLAN',
        'CREATE_TASKS',
        'CREATE_WORKTREE',
        'IMPLEMENT',
        'RUN_TESTS',
        'REVIEW',
        'FIX',
        'RETEST',
        'FINAL_REVIEW',
        'PREPARE_PR',
        'COMPLETE',
      ] as Prisma.InputJsonValue,
    },
  });

  const eng101Run = await prisma.workflowRun.create({
    data: {
      definitionId: workflowDefinition.id,
      definitionKey: 'engineering-task',
      projectId: engloop.id,
      taskId: eng101.id,
      status: 'RUNNING',
      currentStepKey: 'REVIEW',
      reviewCycle: 1,
      attempt: 1,
      idempotencyKey: 'seed:eng-101',
      traceId: 'seed-trace-eng-101',
      startedAt: daysAgo(1),
      state: {
        completedSteps: [
          'ANALYZE_REPOSITORY',
          'PLAN',
          'CREATE_TASKS',
          'CREATE_WORKTREE',
          'IMPLEMENT',
          'RUN_TESTS',
        ],
        failedSteps: [],
        reviewCycle: 1,
        maxReviewCycles: 3,
        attempt: 1,
        maxAttempts: 3,
        testsPassed: true,
        reviewApproved: false,
        hasBlockingFindings: false,
        skipPlanning: false,
        createPullRequest: true,
        permissionLevel: 'LEVEL_3_PR',
        cancelled: false,
        worktreePath: './workspace/worktrees/ENG-101',
        branchName: eng101.branchName,
        baseRef: 'main',
      } as Prisma.InputJsonValue,
      steps: {
        create: [
          {
            stepKey: 'ANALYZE_REPOSITORY',
            sequence: 0,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 4_120,
            startedAt: daysAgo(1),
            finishedAt: daysAgo(1),
          },
          {
            stepKey: 'PLAN',
            sequence: 1,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 9_640,
            startedAt: daysAgo(1),
            finishedAt: daysAgo(1),
          },
          {
            stepKey: 'CREATE_TASKS',
            sequence: 2,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 310,
            startedAt: daysAgo(1),
            finishedAt: daysAgo(1),
          },
          {
            stepKey: 'CREATE_WORKTREE',
            sequence: 3,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 880,
            startedAt: hoursAgo(8),
            finishedAt: hoursAgo(8),
          },
          {
            stepKey: 'IMPLEMENT',
            sequence: 4,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 41_200,
            startedAt: hoursAgo(7),
            finishedAt: hoursAgo(6),
          },
          {
            stepKey: 'RUN_TESTS',
            sequence: 5,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 32_400,
            startedAt: hoursAgo(5),
            finishedAt: hoursAgo(5),
          },
          { stepKey: 'REVIEW', sequence: 6, status: 'RUNNING', attempt: 1, startedAt: hoursAgo(1) },
        ],
      },
    },
    include: { steps: true },
  });

  const eng102Run = await prisma.workflowRun.create({
    data: {
      definitionId: workflowDefinition.id,
      definitionKey: 'engineering-task',
      projectId: engloop.id,
      taskId: eng102.id,
      status: 'SUCCEEDED',
      reviewCycle: 2,
      attempt: 2,
      idempotencyKey: 'seed:eng-102',
      startedAt: daysAgo(8),
      completedAt: daysAgo(6),
      state: {
        completedSteps: [],
        failedSteps: [],
        testsPassed: true,
        reviewApproved: true,
      } as Prisma.InputJsonValue,
      steps: {
        create: [
          {
            stepKey: 'ANALYZE_REPOSITORY',
            sequence: 0,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 3_900,
          },
          { stepKey: 'PLAN', sequence: 1, status: 'SUCCEEDED', attempt: 1, durationMs: 8_100 },
          {
            stepKey: 'CREATE_TASKS',
            sequence: 2,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 260,
          },
          {
            stepKey: 'CREATE_WORKTREE',
            sequence: 3,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 740,
          },
          {
            stepKey: 'IMPLEMENT',
            sequence: 4,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 52_000,
          },
          {
            stepKey: 'RUN_TESTS',
            sequence: 5,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 30_100,
          },
          { stepKey: 'REVIEW', sequence: 6, status: 'SUCCEEDED', attempt: 1, durationMs: 12_400 },
          { stepKey: 'FIX', sequence: 7, status: 'SUCCEEDED', attempt: 1, durationMs: 21_500 },
          { stepKey: 'RETEST', sequence: 8, status: 'SUCCEEDED', attempt: 1, durationMs: 28_900 },
          {
            stepKey: 'FINAL_REVIEW',
            sequence: 9,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 10_200,
          },
          {
            stepKey: 'PREPARE_PR',
            sequence: 10,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 3_300,
          },
          { stepKey: 'COMPLETE', sequence: 11, status: 'SUCCEEDED', attempt: 1, durationMs: 190 },
        ],
      },
    },
  });

  const eng105Run = await prisma.workflowRun.create({
    data: {
      definitionId: workflowDefinition.id,
      definitionKey: 'engineering-task',
      projectId: engloop.id,
      taskId: eng105.id,
      status: 'WAITING_FOR_HUMAN',
      reviewCycle: 3,
      attempt: 3,
      idempotencyKey: 'seed:eng-105',
      error: 'Exhausted 3/3 review cycles and 3/3 attempts',
      startedAt: daysAgo(5),
      completedAt: hoursAgo(9),
      state: {
        testsPassed: false,
        reviewApproved: false,
        hasBlockingFindings: true,
      } as Prisma.InputJsonValue,
      steps: {
        create: [
          {
            stepKey: 'ANALYZE_REPOSITORY',
            sequence: 0,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 4_010,
          },
          { stepKey: 'PLAN', sequence: 1, status: 'SUCCEEDED', attempt: 1, durationMs: 7_700 },
          {
            stepKey: 'CREATE_WORKTREE',
            sequence: 2,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 690,
          },
          {
            stepKey: 'IMPLEMENT',
            sequence: 3,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 38_400,
          },
          {
            stepKey: 'RUN_TESTS',
            sequence: 4,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 26_500,
          },
          { stepKey: 'REVIEW', sequence: 5, status: 'SUCCEEDED', attempt: 1, durationMs: 11_900 },
          { stepKey: 'FIX', sequence: 6, status: 'SUCCEEDED', attempt: 1, durationMs: 19_800 },
          { stepKey: 'RETEST', sequence: 7, status: 'SUCCEEDED', attempt: 1, durationMs: 25_100 },
          {
            stepKey: 'FINAL_REVIEW',
            sequence: 8,
            status: 'SUCCEEDED',
            attempt: 1,
            durationMs: 12_050,
          },
        ],
      },
    },
  });

  await prisma.approval.create({
    data: {
      projectId: engloop.id,
      taskId: eng105.id,
      workflowRunId: eng105Run.id,
      kind: 'IMPLEMENTATION',
      status: 'PENDING',
      reason: 'Exhausted 3/3 review cycles and 3/3 attempts',
      requestedById: null,
      createdAt: hoursAgo(9),
    },
  });

  console.log('  ✓ git state, workflow runs');

  // ---------------------------------------------------------------------
  // Agent runs + usage/cost
  // ---------------------------------------------------------------------
  interface AgentRunSpec {
    taskId: string;
    workflowRunId: string | null;
    agentId: string | undefined;
    role: Prisma.AgentRunCreateInput['role'];
    status: Prisma.AgentRunCreateInput['status'];
    inputTokens: number;
    outputTokens: number;
    cost: number;
    durationMs: number;
    createdAt: Date;
    errorMessage?: string;
  }

  const agentRunSpecs: AgentRunSpec[] = [
    {
      taskId: eng101.id,
      workflowRunId: eng101Run.id,
      agentId: agentByRole.get('ARCHITECT')?.id,
      role: 'ARCHITECT',
      status: 'SUCCEEDED',
      inputTokens: 7_400,
      outputTokens: 1_180,
      cost: 0.0312,
      durationMs: 4_120,
      createdAt: daysAgo(1),
    },
    {
      taskId: eng101.id,
      workflowRunId: eng101Run.id,
      agentId: planner?.id,
      role: 'PLANNER',
      status: 'SUCCEEDED',
      inputTokens: 11_200,
      outputTokens: 3_400,
      cost: 0.0721,
      durationMs: 9_640,
      createdAt: daysAgo(1),
    },
    {
      taskId: eng101.id,
      workflowRunId: eng101Run.id,
      agentId: implementer?.id,
      role: 'IMPLEMENTER',
      status: 'SUCCEEDED',
      inputTokens: 18_900,
      outputTokens: 5_100,
      cost: 0.1841,
      durationMs: 41_200,
      createdAt: hoursAgo(7),
    },
    {
      taskId: eng101.id,
      workflowRunId: eng101Run.id,
      agentId: reviewer?.id,
      role: 'CODE_REVIEWER',
      status: 'RUNNING',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      durationMs: 0,
      createdAt: hoursAgo(1),
    },
    {
      taskId: eng102.id,
      workflowRunId: eng102Run.id,
      agentId: implementer?.id,
      role: 'IMPLEMENTER',
      status: 'SUCCEEDED',
      inputTokens: 22_100,
      outputTokens: 6_800,
      cost: 0.241,
      durationMs: 52_000,
      createdAt: daysAgo(8),
    },
    {
      taskId: eng102.id,
      workflowRunId: eng102Run.id,
      agentId: reviewer?.id,
      role: 'CODE_REVIEWER',
      status: 'SUCCEEDED',
      inputTokens: 15_600,
      outputTokens: 2_900,
      cost: 0.1129,
      durationMs: 12_400,
      createdAt: daysAgo(7),
    },
    {
      taskId: eng102.id,
      workflowRunId: eng102Run.id,
      agentId: implementer?.id,
      role: 'IMPLEMENTER',
      status: 'SUCCEEDED',
      inputTokens: 9_800,
      outputTokens: 2_200,
      cost: 0.0904,
      durationMs: 21_500,
      createdAt: daysAgo(7),
    },
    {
      taskId: eng102.id,
      workflowRunId: eng102Run.id,
      agentId: reviewer?.id,
      role: 'CODE_REVIEWER',
      status: 'SUCCEEDED',
      inputTokens: 14_100,
      outputTokens: 2_400,
      cost: 0.0998,
      durationMs: 10_200,
      createdAt: daysAgo(6),
    },
    {
      taskId: eng103.id,
      workflowRunId: null,
      agentId: implementer?.id,
      role: 'IMPLEMENTER',
      status: 'SUCCEEDED',
      inputTokens: 16_400,
      outputTokens: 4_100,
      cost: 0.1533,
      durationMs: 33_900,
      createdAt: daysAgo(2),
    },
    {
      taskId: eng103.id,
      workflowRunId: null,
      agentId: implementer?.id,
      role: 'IMPLEMENTER',
      status: 'FAILED',
      inputTokens: 5_200,
      outputTokens: 400,
      cost: 0.0201,
      durationMs: 6_100,
      createdAt: hoursAgo(4),
      errorMessage: 'Simulated provider failure (AGENT_MOCK_FAILURE_RATE)',
    },
    {
      taskId: eng104.id,
      workflowRunId: null,
      agentId: implementer?.id,
      role: 'IMPLEMENTER',
      status: 'RUNNING',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      durationMs: 0,
      createdAt: hoursAgo(0.2),
    },
    {
      taskId: eng105.id,
      workflowRunId: eng105Run.id,
      agentId: implementer?.id,
      role: 'IMPLEMENTER',
      status: 'SUCCEEDED',
      inputTokens: 19_400,
      outputTokens: 5_600,
      cost: 0.2033,
      durationMs: 38_400,
      createdAt: daysAgo(5),
    },
    {
      taskId: eng105.id,
      workflowRunId: eng105Run.id,
      agentId: reviewer?.id,
      role: 'CODE_REVIEWER',
      status: 'SUCCEEDED',
      inputTokens: 17_800,
      outputTokens: 3_300,
      cost: 0.1402,
      durationMs: 11_900,
      createdAt: daysAgo(4),
    },
    {
      taskId: eng105.id,
      workflowRunId: eng105Run.id,
      agentId: reviewer?.id,
      role: 'CODE_REVIEWER',
      status: 'SUCCEEDED',
      inputTokens: 18_200,
      outputTokens: 3_500,
      cost: 0.1466,
      durationMs: 12_050,
      createdAt: hoursAgo(9),
    },
    {
      taskId: chat301.id,
      workflowRunId: null,
      agentId: planner?.id,
      role: 'PLANNER',
      status: 'RUNNING',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      durationMs: 0,
      createdAt: hoursAgo(0.5),
    },
  ];

  for (const spec of agentRunSpecs) {
    const completed = spec.status !== 'RUNNING' && spec.status !== 'PENDING';
    const run = await prisma.agentRun.create({
      data: {
        taskId: spec.taskId,
        workflowRunId: spec.workflowRunId,
        agentId: spec.agentId ?? null,
        providerId: mockProvider.id,
        role: spec.role,
        providerKey: 'mock',
        model: 'mock',
        status: spec.status,
        sessionId: `mock-session-${Math.random().toString(36).slice(2, 10)}`,
        inputTokens: spec.inputTokens,
        outputTokens: spec.outputTokens,
        cachedTokens: Math.round(spec.inputTokens * 0.25),
        totalTokens: spec.inputTokens + spec.outputTokens,
        estimatedCost: new Prisma.Decimal(spec.cost),
        errorMessage: spec.errorMessage ?? null,
        errorCode: spec.errorMessage ? 'MOCK_SIMULATED_FAILURE' : null,
        startedAt: spec.createdAt,
        completedAt: completed ? new Date(spec.createdAt.getTime() + spec.durationMs) : null,
        durationMs: completed ? spec.durationMs : null,
        createdAt: spec.createdAt,
        traceId: `seed-${spec.role.toLowerCase()}`,
        messages: completed
          ? {
              create: [
                { role: 'SYSTEM', content: `Mock ${spec.role} run`, sequence: 0 },
                {
                  role: 'ASSISTANT',
                  content: `Produced structured ${spec.role} output.`,
                  sequence: 1,
                },
              ],
            }
          : undefined,
      },
    });

    if (completed && spec.cost > 0) {
      const projectId =
        spec.taskId === erp201.id ? erp.id : spec.taskId === chat301.id ? chatgate.id : engloop.id;

      await prisma.usageRecord.create({
        data: {
          organizationId: organization.id,
          projectId,
          taskId: spec.taskId,
          agentRunId: run.id,
          providerKey: 'mock',
          model: 'mock',
          role: spec.role,
          inputTokens: spec.inputTokens,
          outputTokens: spec.outputTokens,
          cachedTokens: Math.round(spec.inputTokens * 0.25),
          totalTokens: spec.inputTokens + spec.outputTokens,
          durationMs: spec.durationMs,
          occurredAt: spec.createdAt,
          occurredOn: dateOnly(spec.createdAt),
        },
      });

      await prisma.costRecord.create({
        data: {
          organizationId: organization.id,
          projectId,
          taskId: spec.taskId,
          agentRunId: run.id,
          providerKey: 'mock',
          model: 'mock',
          estimatedCost: new Prisma.Decimal(spec.cost),
          occurredAt: spec.createdAt,
          occurredOn: dateOnly(spec.createdAt),
        },
      });
    }
  }

  // ---------------------------------------------------------------------
  // Test runs and results
  // ---------------------------------------------------------------------
  await prisma.testRun.create({
    data: {
      taskId: eng101.id,
      workflowRunId: eng101Run.id,
      status: 'PASSED',
      passed: true,
      totalChecks: 4,
      passedChecks: 4,
      failedChecks: 0,
      durationMs: 32_400,
      worktreePath: './workspace/worktrees/ENG-101',
      startedAt: hoursAgo(5),
      completedAt: hoursAgo(5),
      coverage: { lines: 84.2, statements: 83.9, branches: 71.4, functions: 88.0 },
      results: {
        create: [
          {
            checkType: 'LINT',
            name: 'lint',
            status: 'PASSED',
            command: 'pnpm lint',
            exitCode: 0,
            durationMs: 3_400,
            stdout: 'No ESLint warnings or errors.',
          },
          {
            checkType: 'TYPECHECK',
            name: 'typecheck',
            status: 'PASSED',
            command: 'pnpm typecheck',
            exitCode: 0,
            durationMs: 8_900,
            stdout: 'tsc completed with no errors.',
          },
          {
            checkType: 'UNIT',
            name: 'unit',
            status: 'PASSED',
            command: 'pnpm test',
            exitCode: 0,
            durationMs: 12_600,
            stdout: 'Test Files 24 passed (24)\nTests 187 passed (187)',
          },
          {
            checkType: 'BUILD',
            name: 'build',
            status: 'PASSED',
            command: 'pnpm build',
            exitCode: 0,
            durationMs: 7_500,
            stdout: 'Build succeeded.',
          },
        ],
      },
    },
  });

  const eng103TestRun = await prisma.testRun.create({
    data: {
      taskId: eng103.id,
      status: 'FAILED',
      passed: false,
      totalChecks: 3,
      passedChecks: 2,
      failedChecks: 1,
      durationMs: 21_800,
      worktreePath: './workspace/worktrees/ENG-103',
      startedAt: hoursAgo(4),
      completedAt: hoursAgo(4),
      results: {
        create: [
          {
            checkType: 'LINT',
            name: 'lint',
            status: 'PASSED',
            command: 'pnpm lint',
            exitCode: 0,
            durationMs: 3_100,
            stdout: 'No ESLint warnings or errors.',
          },
          {
            checkType: 'TYPECHECK',
            name: 'typecheck',
            status: 'PASSED',
            command: 'pnpm typecheck',
            exitCode: 0,
            durationMs: 8_200,
            stdout: 'tsc completed with no errors.',
          },
          {
            checkType: 'UNIT',
            name: 'unit',
            status: 'FAILED',
            command: 'pnpm test',
            exitCode: 1,
            durationMs: 10_500,
            stdout: 'Test Files 1 failed | 23 passed (24)\nTests 2 failed | 185 passed (187)',
            stderr:
              'FAIL src/workflow/retry.spec.ts > escalates after maxReviewCycles\n  AssertionError: expected 3 to be 4\n    at retry.spec.ts:48:22',
          },
        ],
      },
    },
  });

  await prisma.testRun.create({
    data: {
      taskId: eng102.id,
      workflowRunId: eng102Run.id,
      status: 'PASSED',
      passed: true,
      totalChecks: 4,
      passedChecks: 4,
      failedChecks: 0,
      durationMs: 28_900,
      startedAt: daysAgo(6),
      completedAt: daysAgo(6),
      coverage: { lines: 91.0, statements: 90.4, branches: 82.1, functions: 94.2 },
      results: {
        create: [
          {
            checkType: 'LINT',
            name: 'lint',
            status: 'PASSED',
            command: 'pnpm lint',
            exitCode: 0,
            durationMs: 3_000,
          },
          {
            checkType: 'TYPECHECK',
            name: 'typecheck',
            status: 'PASSED',
            command: 'pnpm typecheck',
            exitCode: 0,
            durationMs: 8_400,
          },
          {
            checkType: 'UNIT',
            name: 'unit',
            status: 'PASSED',
            command: 'pnpm test',
            exitCode: 0,
            durationMs: 11_200,
          },
          {
            checkType: 'BUILD',
            name: 'build',
            status: 'PASSED',
            command: 'pnpm build',
            exitCode: 0,
            durationMs: 6_300,
          },
        ],
      },
    },
  });

  console.log('  ✓ agent runs, usage, cost, test runs');

  // ---------------------------------------------------------------------
  // Reviews, findings and UI QA
  // ---------------------------------------------------------------------
  const eng101Review = await prisma.reviewRun.create({
    data: {
      taskId: eng101.id,
      workflowRunId: eng101Run.id,
      kind: 'CODE',
      decision: 'CHANGES_REQUESTED',
      status: 'SUCCEEDED',
      cycle: 1,
      score: 61,
      summary:
        'Implementation matches the plan, but one blocking issue and one maintainability issue must be resolved before approval.',
      coverageAssessment: 'The happy path is covered; the expiry branch is not.',
      architectureAssessment: 'Module boundaries look correct.',
      securityAssessment: 'Invitation tokens are stored in plaintext — this must change.',
      performanceAssessment: 'No performance concerns identified.',
      startedAt: hoursAgo(2),
      completedAt: hoursAgo(2),
      findings: {
        create: [
          {
            taskId: eng101.id,
            severity: 'HIGH',
            category: 'SECURITY',
            file: 'apps/api/src/modules/organizations/invitations.service.ts',
            line: 42,
            problem:
              'The invitation token is persisted in plaintext, so a database read leaks working invite links.',
            requiredFix: 'Store a SHA-256 hash of the token and compare hashes on acceptance.',
            status: 'OPEN',
          },
          {
            taskId: eng101.id,
            severity: 'MEDIUM',
            category: 'TESTING',
            file: null,
            line: null,
            problem: 'The 7-day expiry branch is not covered by any test.',
            requiredFix: 'Add a unit test that asserts an expired invitation is rejected.',
            status: 'OPEN',
          },
          {
            taskId: eng101.id,
            severity: 'LOW',
            category: 'DOCUMENTATION',
            file: 'docs/api.md',
            line: null,
            problem: 'The new endpoints are not documented.',
            requiredFix: 'Add the three invitation endpoints to docs/api.md.',
            status: 'OPEN',
          },
        ],
      },
    },
  });

  await prisma.reviewRun.create({
    data: {
      taskId: eng102.id,
      workflowRunId: eng102Run.id,
      kind: 'CODE',
      decision: 'APPROVED',
      status: 'SUCCEEDED',
      cycle: 2,
      score: 94,
      summary:
        'All acceptance criteria are met, deterministic checks pass and the previous findings are resolved.',
      coverageAssessment: 'Coverage on changed lines is adequate for the risk level.',
      architectureAssessment: 'No module outside the adapters references a vendor. Good.',
      securityAssessment: 'No credential handling issues in the diff.',
      performanceAssessment: 'Registry lookups are O(1).',
      startedAt: daysAgo(6),
      completedAt: daysAgo(6),
    },
  });

  await prisma.reviewRun.create({
    data: {
      taskId: eng105.id,
      workflowRunId: eng105Run.id,
      kind: 'SECURITY',
      decision: 'CHANGES_REQUESTED',
      status: 'SUCCEEDED',
      cycle: 3,
      score: 48,
      summary: 'The audit parser still mis-handles advisories with no fixed version.',
      securityAssessment: 'Unparsed advisories are silently dropped, which hides real findings.',
      startedAt: hoursAgo(9),
      completedAt: hoursAgo(9),
      findings: {
        create: [
          {
            taskId: eng105.id,
            severity: 'CRITICAL',
            category: 'SECURITY',
            file: 'apps/worker/src/services/audit-parser.ts',
            line: 78,
            problem: 'Advisories without a fixed version are dropped instead of reported.',
            requiredFix:
              'Emit an INFO finding for unfixable advisories rather than discarding them.',
            status: 'OPEN',
          },
          {
            taskId: eng105.id,
            severity: 'HIGH',
            category: 'CORRECTNESS',
            file: 'apps/worker/src/services/audit-parser.ts',
            line: 120,
            problem: 'A non-zero audit exit code is treated as a parser failure.',
            requiredFix: 'Distinguish "audit found issues" (expected) from "audit crashed".',
            status: 'OPEN',
          },
        ],
      },
    },
  });

  const uiReview = await prisma.reviewRun.create({
    data: {
      taskId: eng104.id,
      kind: 'UI',
      decision: 'CHANGES_REQUESTED',
      status: 'SUCCEEDED',
      cycle: 1,
      score: 72,
      summary: 'Layout holds at desktop and tablet; one overflow issue remains at 375px.',
      startedAt: hoursAgo(1),
      completedAt: hoursAgo(1),
    },
  });

  const screenshots = await Promise.all(
    [
      { viewport: 'DESKTOP' as const, width: 1440, height: 900 },
      { viewport: 'TABLET' as const, width: 768, height: 1024 },
      { viewport: 'MOBILE' as const, width: 375, height: 812 },
    ].map((preset) =>
      prisma.screenshot.create({
        data: {
          reviewRunId: uiReview.id,
          taskId: eng104.id,
          page: '/tasks',
          viewport: preset.viewport,
          width: preset.width,
          height: preset.height,
          storagePath: `workspace/artifacts/ENG-104/${preset.viewport.toLowerCase()}.png`,
          consoleErrors:
            preset.viewport === 'MOBILE'
              ? ['Warning: Each child in a list should have a unique "key" prop.']
              : [],
          failedRequests: [],
        },
      }),
    ),
  );

  await prisma.reviewFinding.create({
    data: {
      reviewRunId: uiReview.id,
      taskId: eng104.id,
      severity: 'MEDIUM',
      category: 'UI',
      uiCategory: 'OVERFLOW',
      viewport: 'MOBILE',
      screenshotId: screenshots.find((shot) => shot.viewport === 'MOBILE')?.id,
      file: '/tasks',
      problem: 'The task table forces horizontal scrolling at 375px.',
      requiredFix: 'Collapse the table into stacked cards below the md breakpoint.',
      status: 'OPEN',
    },
  });

  // ---------------------------------------------------------------------
  // Artifacts
  // ---------------------------------------------------------------------
  await prisma.artifact.createMany({
    data: [
      {
        taskId: eng101.id,
        kind: 'DIFF',
        name: 'ENG-101.patch',
        contentType: 'text/x-diff',
        sizeBytes: 2_480,
        content: `diff --git a/apps/api/src/modules/organizations/invitations.service.ts b/apps/api/src/modules/organizations/invitations.service.ts
new file mode 100644
--- /dev/null
+++ b/apps/api/src/modules/organizations/invitations.service.ts
@@ -0,0 +1,64 @@
+import { Injectable } from '@nestjs/common';
+
+@Injectable()
+export class InvitationsService {
+  // ... created by the implementation agent
+}
`,
        metadata: { baseRef: 'main', fileCount: 6, truncated: false },
      },
      {
        taskId: eng103.id,
        kind: 'LOG',
        name: 'unit-failure.log',
        contentType: 'text/plain',
        sizeBytes: 412,
        content:
          'FAIL src/workflow/retry.spec.ts > escalates after maxReviewCycles\n  AssertionError: expected 3 to be 4',
        testRunId: eng103TestRun.id,
        metadata: { checkType: 'UNIT' },
      },
      {
        taskId: eng102.id,
        kind: 'COVERAGE',
        name: 'coverage-summary.json',
        contentType: 'application/json',
        sizeBytes: 180,
        content: '{"lines":91.0,"statements":90.4,"branches":82.1,"functions":94.2}',
      },
    ],
  });

  // ---------------------------------------------------------------------
  // Schedules, notifications, audit log
  // ---------------------------------------------------------------------
  await prisma.schedule.createMany({
    data: [
      {
        projectId: engloop.id,
        repositoryId: engloopApi.id,
        name: 'Nightly security scan',
        type: 'SECURITY_SCAN',
        cronExpression: '0 2 * * *',
        timezone: 'Asia/Bangkok',
        enabled: true,
        lastRunAt: hoursAgo(14),
        nextRunAt: hoursAgo(-10),
        lastStatus: 'SUCCEEDED',
      },
      {
        projectId: engloop.id,
        name: 'Weekly technical-debt analysis',
        type: 'TECH_DEBT_ANALYSIS',
        cronExpression: '0 9 * * 1',
        timezone: 'Asia/Bangkok',
        enabled: true,
        nextRunAt: hoursAgo(-72),
      },
      {
        projectId: engloop.id,
        repositoryId: engloopWeb.id,
        name: 'UI quality sweep',
        type: 'UI_QUALITY_REVIEW',
        cronExpression: '0 6 * * 1-5',
        timezone: 'Asia/Bangkok',
        enabled: false,
      },
      {
        projectId: erp.id,
        name: 'Dependency review',
        type: 'DEPENDENCY_REVIEW',
        cronExpression: '0 3 * * 3',
        timezone: 'UTC',
        enabled: true,
        nextRunAt: hoursAgo(-40),
      },
    ],
  });

  await prisma.notification.createMany({
    data: [
      {
        organizationId: organization.id,
        userId: founder.id,
        type: 'HUMAN_APPROVAL_REQUIRED',
        title: 'ENG-105 needs human review',
        body: 'Add security audit command exhausted its automated review cycles.',
        severity: 'HIGH',
        payload: { taskId: eng105.id, taskKey: 'ENG-105' },
        createdAt: hoursAgo(9),
        deliveredAt: hoursAgo(9),
      },
      {
        organizationId: organization.id,
        userId: founder.id,
        type: 'TEST_FAILED',
        title: 'ENG-103: checks failed',
        body: 'Failing checks: UNIT',
        severity: 'HIGH',
        payload: { taskId: eng103.id, testRunId: eng103TestRun.id },
        createdAt: hoursAgo(4),
        deliveredAt: hoursAgo(4),
      },
      {
        organizationId: organization.id,
        userId: founder.id,
        type: 'REVIEW_REQUIRED',
        title: 'ENG-101: reviewer requested changes',
        body: '3 findings (1 high, 1 medium, 1 low).',
        severity: 'MEDIUM',
        payload: { taskId: eng101.id, reviewRunId: eng101Review.id },
        createdAt: hoursAgo(2),
        deliveredAt: hoursAgo(2),
      },
      {
        organizationId: organization.id,
        userId: founder.id,
        type: 'WORKFLOW_COMPLETED',
        title: 'ENG-102 completed',
        body: 'Agent provider abstraction merged after 2 review cycles.',
        severity: 'INFO',
        payload: { taskId: eng102.id },
        readAt: daysAgo(5),
        createdAt: daysAgo(6),
        deliveredAt: daysAgo(6),
      },
    ],
  });

  const auditEntries: Prisma.AuditLogCreateManyInput[] = [
    {
      organizationId: organization.id,
      projectId: engloop.id,
      taskId: eng101.id,
      action: 'TASK_TRANSITIONED',
      entityType: 'task',
      entityId: eng101.id,
      summary: 'ENG-101: TESTING → REVIEWING',
      actorType: 'SYSTEM',
      createdAt: hoursAgo(2),
    },
    {
      organizationId: organization.id,
      projectId: engloop.id,
      taskId: eng101.id,
      action: 'REVIEW_DECISION',
      entityType: 'review_run',
      entityId: eng101Review.id,
      summary: 'Reviewer requested changes (3 findings)',
      actorType: 'AGENT',
      createdAt: hoursAgo(2),
    },
    {
      organizationId: organization.id,
      projectId: engloop.id,
      taskId: eng101.id,
      action: 'AGENT_STARTED',
      entityType: 'agent_run',
      summary: 'CODE_REVIEWER started on mock',
      actorType: 'AGENT',
      createdAt: hoursAgo(1),
    },
    {
      organizationId: organization.id,
      projectId: engloop.id,
      taskId: eng103.id,
      action: 'COMMAND_EXECUTED',
      entityType: 'test_result',
      summary: 'UNIT: pnpm test → exit 1',
      actorType: 'SYSTEM',
      createdAt: hoursAgo(4),
    },
    {
      organizationId: organization.id,
      projectId: engloop.id,
      taskId: eng105.id,
      action: 'TASK_TRANSITIONED',
      entityType: 'task',
      entityId: eng105.id,
      summary: 'ENG-105: REVIEWING → NEEDS_HUMAN_REVIEW',
      actorType: 'SYSTEM',
      createdAt: hoursAgo(9),
    },
    {
      organizationId: organization.id,
      projectId: engloop.id,
      taskId: eng104.id,
      action: 'GIT_ACTION',
      entityType: 'git_worktree',
      summary:
        'Created worktree ./workspace/worktrees/ENG-104 on agent/ENG-104-improve-mobile-sidebar-responsiveness',
      actorType: 'SYSTEM',
      createdAt: hoursAgo(2),
    },
    {
      organizationId: organization.id,
      projectId: engloop.id,
      taskId: eng102.id,
      action: 'GIT_ACTION',
      entityType: 'pull_request',
      summary: 'Opened pull request ENG-102: Add agent provider abstraction',
      actorType: 'SYSTEM',
      createdAt: daysAgo(7),
    },
    {
      organizationId: organization.id,
      projectId: engloop.id,
      action: 'CONFIGURATION_CHANGED',
      entityType: 'project.roleAssignments',
      summary: 'Updated agent role assignments',
      actorType: 'USER',
      userId: founder.id,
      createdAt: daysAgo(9),
    },
    {
      organizationId: organization.id,
      projectId: engloop.id,
      action: 'SCHEDULE_CHANGED',
      entityType: 'schedule',
      summary: 'Created schedule Nightly security scan (0 2 * * *)',
      actorType: 'USER',
      userId: engineer.id,
      createdAt: daysAgo(5),
    },
  ];
  await prisma.auditLog.createMany({ data: auditEntries });

  console.log('  ✓ reviews, findings, UI QA, schedules, notifications, audit log');

  const counts = {
    projects: await prisma.project.count(),
    repositories: await prisma.repository.count(),
    tasks: await prisma.task.count(),
    agents: await prisma.agent.count(),
    agentRuns: await prisma.agentRun.count(),
    testRuns: await prisma.testRun.count(),
    reviewRuns: await prisma.reviewRun.count(),
    findings: await prisma.reviewFinding.count(),
    workflowRuns: await prisma.workflowRun.count(),
    auditLogs: await prisma.auditLog.count(),
  };

  console.log('› Seed complete:', counts);
  console.log('› Sign in with founder@evalley.dev / engloop-dev-password');
  console.log('  (AUTH_DEV_BYPASS=true resolves this user automatically in development.)');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
