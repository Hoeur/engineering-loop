import { describe, expect, it, vi } from 'vitest';
import { RunStatus } from '@engloop/types';
import { defaultPersistedState } from '../state';
import { createTasksStep, planStep } from './analyze-and-plan';
import type { StepExecutionContext } from './types';

const scope = { phaseId: 'cphase12345678901234567890', phaseUpdatedAt: '2026-10-08T00:00:00.000Z' };
const output = {
  summary: 'Deliver phase',
  approach: 'Incremental',
  phaseScope: scope,
  tasks: [
    {
      title: 'Deliver service',
      objective: 'Provide search',
      ownerRole: 'BACKEND_DEVELOPER',
      acceptanceCriteria: ['Search verified'],
      requiredChecks: ['UNIT'],
    },
  ],
};
const fixture = (phaseId: string | null = scope.phaseId) => {
  const task = {
    id: 'parent',
    projectId: 'project',
    phaseId,
    title: 'Parent',
    objective: 'Deliver parent',
    type: 'FEATURE',
    priority: 'MEDIUM',
  };
  const phase = {
    id: scope.phaseId,
    projectId: 'project',
    status: 'ACTIVE',
    updatedAt: new Date(scope.phaseUpdatedAt),
    name: 'Search',
    objective: 'Search objective',
    deliverables: ['Search'],
    acceptanceCriteria: ['Search works'],
    requiredRoles: ['BACKEND_DEVELOPER'],
  };
  const worker = {
    prisma: {
      task: { findUniqueOrThrow: vi.fn(async () => task) },
      projectPhase: { findUnique: vi.fn(async () => phase) },
      project: {
        findUniqueOrThrow: vi.fn(async () => ({
          contractRequirements: ['Project requirement'],
          contractObjective: null,
          contractNonGoals: ['No other phases'],
          contractAcceptanceCriteria: ['Project verified'],
        })),
      },
      workflowStep: { findFirst: vi.fn(async () => ({ output })) },
    },
    agents: { execute: vi.fn(async () => ({ status: 'SUCCEEDED', output })) },
    plans: { materialize: vi.fn(async () => ({ createdTaskIds: ['child'] })) },
  };
  const context = {
    worker,
    task,
    state: defaultPersistedState({ worktreePath: '/isolated/worktree' }),
    traceId: 'trace',
    run: { id: 'run' },
    step: { id: 'step' },
  } as unknown as StepExecutionContext;
  return { worker, context, phase };
};

describe('bounded phase planning steps', () => {
  it('builds validated phase input and preserves provider scope in the stored output', async () => {
    const { worker, context } = fixture();
    const result = await planStep(context);
    expect(result.status).toBe(RunStatus.SUCCEEDED);
    expect(result.output).toMatchObject({ phaseScope: scope });
    expect(worker.agents.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          phaseContext: expect.objectContaining({
            ...scope,
            projectRequirements: ['Project requirement'],
            name: 'Search',
          }),
        }),
      }),
    );
  });
  it.each(['DRAFT', 'ACCEPTED', 'foreign'])(
    'rejects %s phase before provider invocation',
    async (status) => {
      const { worker, context, phase } = fixture();
      if (status === 'foreign') phase.projectId = 'other';
      else phase.status = status;
      await expect(planStep(context)).rejects.toThrow('ACTIVE phase');
      expect(worker.agents.execute).not.toHaveBeenCalled();
    },
  );
  it('rejects a provider scope that does not echo the input version', async () => {
    const { worker, context } = fixture();
    worker.agents.execute.mockResolvedValueOnce({
      status: 'SUCCEEDED',
      output: {
        ...output,
        phaseScope: { ...scope, phaseUpdatedAt: '2026-10-09T00:00:00.000Z' },
      },
    });
    await expect(planStep(context)).rejects.toThrow('phase scope');
  });
  it('rejects corrupted stored plans before invoking materialization', async () => {
    const { worker, context } = fixture();
    worker.prisma.workflowStep.findFirst.mockResolvedValueOnce({
      output: { ...output, tasks: [] },
    });
    expect((await createTasksStep(context)).status).toBe(RunStatus.FAILED);
    expect(worker.plans.materialize).not.toHaveBeenCalled();
  });
  it('keeps the unphased legacy input free of phase scope', async () => {
    const { worker, context } = fixture(null);
    const legacy = { ...output, phaseScope: undefined };
    worker.agents.execute.mockResolvedValueOnce({ status: 'SUCCEEDED', output: legacy });
    expect((await planStep(context)).status).toBe(RunStatus.SUCCEEDED);
    expect(worker.prisma.projectPhase.findUnique).not.toHaveBeenCalled();
    expect(worker.agents.execute.mock.calls[0]?.[0]).not.toHaveProperty('input.phaseContext');
  });
});
