import type { WorkflowExecutionSnapshot } from '@engloop/schemas';

export function snapshotFixture(
  ids = {
    organizationId: 'org-1',
    projectId: 'project-1',
    taskId: 'task-1',
    agentId: 'agent-1',
    providerId: 'provider-1',
  },
): WorkflowExecutionSnapshot {
  const timestamp = '2026-10-13T00:00:00.000Z';
  return {
    version: 1,
    organizationId: ids.organizationId,
    projectId: ids.projectId,
    taskId: ids.taskId,
    capturedAt: timestamp,
    task: {
      id: ids.taskId,
      key: 'ENG-101',
      title: 'Original task',
      description: 'Original description',
      objective: 'Original objective',
      type: 'FEATURE',
      priority: 'MEDIUM',
      riskLevel: 'MEDIUM',
      acceptanceCriteria: ['Original criterion'],
      implementationNotes: [],
      suggestedFiles: ['src/index.ts'],
      requiredChecks: ['TYPECHECK'],
      phaseId: null,
      ownerRole: 'IMPLEMENTER',
      maxAttempts: 3,
      updatedAt: timestamp,
    },
    project: {
      id: ids.projectId,
      name: 'Original project',
      slug: 'original',
      description: 'Original project description',
      permissionLevel: 'LEVEL_3_PR',
      maxReviewCycles: 3,
      costBudgetUsd: 5,
      uiQaEnabled: false,
      documentationEnabled: false,
      teamVersion: 1,
    },
    repository: null,
    memories: [
      { id: 'memory-1', kind: 'ARCHITECTURE', version: 1, content: 'Original architecture' },
    ],
    roles: [
      {
        role: 'IMPLEMENTER',
        agentId: ids.agentId,
        providerId: ids.providerId,
        providerKey: 'snapshot-mock',
        providerKind: 'MOCK',
        model: 'original-model',
        providerUpdatedAt: timestamp,
        configurationVersions: [],
        systemPrompt: 'Original system instruction',
        permissionLevel: 'LEVEL_3_PR',
        budget: {
          timeoutMs: 5000,
          maxTokens: 1000,
          maxCostUsd: 2,
          allowedCommands: ['pnpm', 'git'],
        },
        prompt: {
          templateId: 'prompt-1',
          revision: 1,
          body: 'Task {{task.title}}',
          rendered: 'Task Original task',
        },
      },
    ],
    artifacts: [],
  };
}
