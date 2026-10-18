import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@engloop/db';
import type { Env } from '@engloop/config';
import {
  executionSelectionSchema,
  runTaskSchema,
  workflowExecutionSnapshotSchema,
} from '@engloop/schemas';
import { ExecutionSnapshotsService } from './execution-snapshots.service';

const env = {
  AGENT_DEFAULT_PROVIDER: 'mock',
  AGENT_RUN_TIMEOUT_MS: 10000,
  AGENT_TOKEN_BUDGET: 1000,
  AGENT_COST_BUDGET_USD: 2,
  COMMAND_ALLOWLIST: ['git', 'pnpm'],
  CODEX_MODEL: 'pinned-codex',
  CLAUDE_CODE_MODEL: 'pinned-claude',
} as Env;
const fixture = () => {
  const project = {
    id: 'project-1',
    name: 'Project',
    slug: 'project',
    description: null,
    permissionLevel: 'LEVEL_3_PR',
    maxReviewCycles: 3,
    costBudgetUsd: 50,
    teamVersion: 0,
    teamConfigured: false,
    roleAssignments: {},
    settings: { documentation: { enabled: false } },
    contractObjective: null,
    contractRequirements: [],
    contractNonGoals: [],
    contractAcceptanceCriteria: [],
    organization: { defaultProviderKey: 'mock' },
  };
  const task = {
    id: 'task-1',
    projectId: project.id,
    key: 'TASK-1',
    title: 'Implement title',
    description: 'Requirement',
    objective: '',
    type: 'FEATURE',
    priority: 'MEDIUM',
    riskLevel: 'MEDIUM',
    acceptanceCriteria: [],
    implementationNotes: [],
    suggestedFiles: [],
    requiredChecks: [],
    phaseId: null,
    ownerRole: null,
    maxAttempts: 3,
    updatedAt: new Date(),
    project,
    repository: null,
  };
  const provider = {
    id: 'provider-1',
    key: 'mock',
    kind: 'MOCK',
    defaultModel: null,
    updatedAt: new Date(),
  };
  const tx = {
    task: { findFirst: vi.fn().mockResolvedValue(task) },
    agent: { findFirst: vi.fn().mockResolvedValue(null) },
    agentProvider: { findFirst: vi.fn().mockResolvedValue(provider) },
    projectMemory: { findMany: vi.fn().mockResolvedValue([]) },
    artifact: { findMany: vi.fn().mockResolvedValue([]) },
    promptRevision: { findFirst: vi.fn().mockResolvedValue({ body: '{{task.title}} {{role}}' }) },
  };
  const capture = (
    prompts: Array<{ role: 'IMPLEMENTER'; templateId: string; revision: number }> = [],
  ) =>
    new ExecutionSnapshotsService(env).capture(
      tx as unknown as Prisma.TransactionClient,
      'org-1',
      task.id,
      { prompts },
      { planOnly: false, skipPlanning: true },
    );
  return { tx, capture, project, provider };
};

describe('ExecutionSnapshotsService', () => {
  it('preserves opt-in absence and rejects duplicate prompt roles', () => {
    expect(runTaskSchema.parse({})).not.toHaveProperty('execution');
    expect(executionSelectionSchema.parse({})).toEqual({ prompts: [] });
    expect(() =>
      executionSelectionSchema.parse({
        prompts: [
          { role: 'IMPLEMENTER', templateId: 'template-1', revision: 1 },
          { role: 'IMPLEMENTER', templateId: 'template-2', revision: 1 },
        ],
      }),
    ).toThrow('Select at most one prompt');
  });
  it('pins fallback provider metadata and reads only safe provider fields', async () => {
    const { tx, capture } = fixture();
    const result = await capture();
    expect(result.roles.map((role) => role.role)).toEqual(['IMPLEMENTER', 'CODE_REVIEWER']);
    expect(result.roles[0]).toMatchObject({
      providerId: 'provider-1',
      agentId: null,
      budget: { allowedCommands: ['git', 'pnpm'] },
    });
    expect(tx.agentProvider.findFirst.mock.calls[0]?.[0].select).toEqual({
      id: true,
      key: true,
      kind: true,
      defaultModel: true,
      updatedAt: true,
    });
  });
  it('treats a zero project budget as unlimited while retaining role process limits', async () => {
    const { capture, project } = fixture();
    project.costBudgetUsd = 0;
    expect((await capture()).roles[0]?.budget.maxCostUsd).toBe(2);
  });
  it('validates selections even when called outside the HTTP validation pipe', async () => {
    const { capture, tx } = fixture();
    await expect(
      capture([
        { role: 'IMPLEMENTER', templateId: 'template-1', revision: 1 },
        { role: 'IMPLEMENTER', templateId: 'template-2', revision: 1 },
      ]),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(tx.task.findFirst).not.toHaveBeenCalled();
  });
  it('rejects mismatched snapshot ownership and duplicate role bindings', async () => {
    const snapshot = await fixture().capture();
    expect(
      workflowExecutionSnapshotSchema.safeParse({ ...snapshot, taskId: 'foreign-task' }).success,
    ).toBe(false);
    expect(
      workflowExecutionSnapshotSchema.safeParse({
        ...snapshot,
        roles: [snapshot.roles[0], snapshot.roles[0]],
      }).success,
    ).toBe(false);
  });
  it('renders selected prompts using captured task values', async () => {
    const { capture } = fixture();
    const result = await capture([{ role: 'IMPLEMENTER', templateId: 'template-1', revision: 2 }]);
    expect(result.roles[0]?.prompt).toEqual({
      templateId: 'template-1',
      revision: 2,
      body: '{{task.title}} {{role}}',
      rendered: 'Implement title IMPLEMENTER',
    });
  });
  it.each(['{{project.objective}}', '{{task.objective}}', '{{task.acceptanceCriteria}}'])(
    'rejects %s when the stored value is missing, blank or empty instead of rendering a hole',
    async (body) => {
      const { capture, tx } = fixture();
      tx.promptRevision.findFirst.mockResolvedValue({ body });
      await expect(
        capture([{ role: 'IMPLEMENTER', templateId: 'template-1', revision: 1 }]),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );
  it('pins built-in process default model when provider default is absent', async () => {
    const { capture, provider } = fixture();
    provider.kind = 'CODEX';
    expect((await capture()).roles[0]?.model).toBe('pinned-codex');
  });
  it('fails closed when configured roster does not cover execution roles', async () => {
    const { capture, project, tx } = fixture();
    project.teamConfigured = true;
    await expect(capture()).rejects.toMatchObject({ code: 'PROJECT_TEAM_ROLE_UNCOVERED' });
    expect(tx.agentProvider.findFirst).not.toHaveBeenCalled();
  });
  it('rejects unknown providers and prompt placeholders before creating a run', async () => {
    const { capture, tx } = fixture();
    tx.agentProvider.findFirst.mockResolvedValueOnce(null);
    await expect(capture()).rejects.toThrow('No enabled provider');
    tx.promptRevision.findFirst.mockResolvedValue({ body: '{{phase.objective}}' });
    await expect(
      capture([{ role: 'IMPLEMENTER', templateId: 'template-1', revision: 1 }]),
    ).rejects.toThrow('Unresolved prompt variable');
  });
});
