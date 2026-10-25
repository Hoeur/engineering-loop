import { describe, expect, it, vi } from 'vitest';
import type { WorkflowExecutionSnapshot } from '@engloop/schemas';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExecutionPreviewService } from './execution-preview.service';
import { ExecutionSnapshotsService } from './execution-snapshots.service';

function fixture() {
  const tx = { task: { create: vi.fn() }, workflowRun: { create: vi.fn() } };
  const prisma = {
    $transaction: vi.fn(async (callback: (value: unknown) => unknown) => callback(tx)),
  };
  const capture = vi.fn().mockResolvedValue({
    capturedAt: new Date().toISOString(),
    taskId: 'task-one',
    memories: [{ content: 'PRIVATE_MEMORY' }],
    roles: [
      {
        role: 'IMPLEMENTER',
        agentId: 'agent-one',
        providerId: 'provider-one',
        providerKey: 'codex',
        providerKind: 'CODEX',
        model: 'model-one',
        providerUpdatedAt: new Date().toISOString(),
        systemPrompt: 'PRIVATE_SYSTEM',
        configurationVersions: [{ id: 'config-one', version: 1 }],
        permissionLevel: 'LEVEL_2_CODE',
        budget: { timeoutMs: 1000, maxTokens: 200, maxCostUsd: 1, allowedCommands: ['git'] },
        prompt: {
          templateId: 'template-one',
          revision: 2,
          body: '{{task.title}}',
          rendered: 'Task title',
        },
      },
    ],
  } as unknown as WorkflowExecutionSnapshot);
  const service = new ExecutionPreviewService(
    prisma as unknown as PrismaService,
    { capture } as unknown as ExecutionSnapshotsService,
  );
  return { service, capture, prisma, tx };
}

describe('ExecutionPreviewService', () => {
  it('resolves exact selections through capture and exposes only preview fields without writes', async () => {
    const { service, capture, prisma, tx } = fixture();
    const execution = {
      prompts: [{ role: 'IMPLEMENTER' as const, templateId: 'template-one', revision: 2 }],
    };
    const result = await service.preview('org-one', 'task-one', {
      mode: 'run',
      skipPlanning: true,
      execution,
    });
    expect(capture).toHaveBeenCalledWith(tx, 'org-one', 'task-one', execution, {
      planOnly: false,
      skipPlanning: true,
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(result.roles[0]?.prompt?.revision).toBe(2);
    expect(result.roles[0]).not.toHaveProperty('systemPrompt');
    expect(result.roles[0]).not.toHaveProperty('configurationVersions');
    expect(result.roles[0]).not.toHaveProperty('providerId');
    expect(result).not.toHaveProperty('memories');
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.workflowRun.create).not.toHaveBeenCalled();
  });

  it('uses planner workflow roles and rejects invalid mode/selection before database reads', async () => {
    const { service, capture, prisma } = fixture();
    await service.preview('org-one', 'task-one', {
      mode: 'plan',
      skipPlanning: false,
      execution: { prompts: [] },
    });
    expect(capture).toHaveBeenLastCalledWith(
      expect.anything(),
      'org-one',
      'task-one',
      { prompts: [] },
      { planOnly: true, skipPlanning: false },
    );
    prisma.$transaction.mockClear();
    await expect(
      service.preview('org-one', 'task-one', {
        mode: 'plan',
        skipPlanning: true,
        execution: { prompts: [] },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('propagates unavailable prompt and agent failures without falling back', async () => {
    const { service, capture } = fixture();
    capture.mockRejectedValue(new Error('No eligible project team member'));
    await expect(
      service.preview('org-one', 'task-one', {
        mode: 'run',
        skipPlanning: true,
        execution: { prompts: [] },
      }),
    ).rejects.toThrow('No eligible');
  });

  it('fails closed for a task outside the caller organization', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const tx = { task: { findFirst } };
    const prisma = { $transaction: async (callback: (value: unknown) => unknown) => callback(tx) };
    const service = new ExecutionPreviewService(
      prisma as unknown as PrismaService,
      new ExecutionSnapshotsService({} as never),
    );
    await expect(
      service.preview('other-org', 'task-one', {
        mode: 'run',
        skipPlanning: false,
        execution: { prompts: [] },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-one', project: { organizationId: 'other-org' } },
      }),
    );
  });
});
