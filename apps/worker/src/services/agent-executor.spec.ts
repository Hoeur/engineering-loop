import { AgentRole, AgentRunStatus, RunStatus, TaskStatus } from '@engloop/types';
import { ProviderUnavailableError } from '@engloop/agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { AgentExecutor } from './agent-executor';

describe('AgentExecutor', () => {
  it.each([false, true])(
    'fails closed before creating a run when the provider is disabled and budgetExceeded=%s',
    async (budgetExceeded) => {
    const createRun = vi.fn();
    const resolveProvider = vi.fn();
    const recordAudit = vi.fn();
    const prisma = {
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'task-1',
          key: 'ENG-1',
          projectId: 'project-1',
          project: { organizationId: 'org-1' },
        }),
      },
      agentProvider: { findFirst: vi.fn().mockResolvedValue(null) },
      agentRun: { create: createRun },
    };
    const logger = {
      warn: vi.fn(),
      withContext: vi.fn(),
    };

    const executor = new AgentExecutor({
      prisma,
      registry: { resolve: resolveProvider },
      logger,
      env: {},
      audit: { record: recordAudit },
      usage: {
        budgetExceeded: vi.fn().mockResolvedValue({
          exceeded: budgetExceeded,
          spent: budgetExceeded ? 5 : 0,
          limit: 5,
        }),
      },
      contextBuilder: {
        resolveRoleProvider: vi.fn().mockResolvedValue({
          providerKey: 'codex',
          model: 'gpt-6-astra',
          agentId: null,
        }),
      },
    } as never);

    await expect(
      executor.execute({
        taskId: 'task-1',
        role: AgentRole.IMPLEMENTER,
        input: {},
        workspacePath: 'C:\\worktree',
        traceId: 'trace-1',
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);

    expect(createRun).not.toHaveBeenCalled();
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    },
  );

  it('rejects a workflow run linked to another project before creating an agent run', async () => {
    const create = vi.fn();
    const findProvider = vi.fn();
    const executor = new AgentExecutor({
      prisma: {
        task: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'task-1',
            key: 'ENG-1',
            projectId: 'project-1',
            project: { organizationId: 'org-1' },
          }),
          findUnique: vi.fn().mockResolvedValue({ status: TaskStatus.IMPLEMENTING }),
        },
        workflowRun: {
          findUnique: vi.fn().mockResolvedValue({ projectId: 'project-2', taskId: 'task-1' }),
        },
        agentProvider: { findFirst: findProvider },
        agentRun: { create },
      },
      registry: {},
      logger: {},
      env: {},
      audit: {},
      usage: {},
      contextBuilder: {},
    } as never);

    await expect(
      executor.execute({
        taskId: 'task-1',
        workflowRunId: 'workflow-1',
        role: AgentRole.IMPLEMENTER,
        input: {},
        workspacePath: 'C:\\worktree',
        traceId: 'trace-1',
      }),
    ).rejects.toThrow('Workflow run does not belong to the input task and project');

    expect(findProvider).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a workflow step linked to a different run before creating an agent run', async () => {
    const create = vi.fn();
    const findWorkflowRun = vi.fn();
    const executor = new AgentExecutor({
      prisma: {
        task: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'task-1',
            key: 'ENG-1',
            projectId: 'project-1',
            project: { organizationId: 'org-1' },
          }),
        },
        workflowStep: {
          findUnique: vi.fn().mockResolvedValue({
            workflowRunId: 'workflow-2',
            workflowRun: { projectId: 'project-1', taskId: 'task-1' },
          }),
        },
        workflowRun: { findUnique: findWorkflowRun },
        agentProvider: { findFirst: vi.fn() },
        agentRun: { create },
      },
      registry: {},
      logger: {},
      env: {},
      audit: {},
      usage: {},
      contextBuilder: {},
    } as never);

    await expect(
      executor.execute({
        taskId: 'task-1',
        workflowRunId: 'workflow-1',
        workflowStepId: 'step-1',
        role: AgentRole.IMPLEMENTER,
        input: {},
        workspacePath: 'C:\\worktree',
        traceId: 'trace-1',
      }),
    ).rejects.toThrow('Workflow step does not belong to the input task and project');

    expect(findWorkflowRun).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not persist provider output or messages when cancellation wins', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const createMessages = vi.fn();
    const recordUsage = vi.fn();
    const recordAudit = vi.fn().mockResolvedValue(undefined);
    const resolveProvider = vi.fn().mockReturnValue({
      key: 'mock',
      capabilities: { models: [] },
      startRun: vi.fn().mockRejectedValue(new Error('cancelled')),
    });
    const prisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ status: TaskStatus.IMPLEMENTING }]),
        $transaction: vi.fn(),
        task: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'task-1',
            key: 'ENG-1',
            projectId: 'project-1',
            project: { organizationId: 'org-1' },
          }),
          findUnique: vi.fn().mockResolvedValue({ status: TaskStatus.IMPLEMENTING }),
        },
        agentProvider: { findFirst: vi.fn().mockResolvedValue({ id: 'provider-1' }) },
        agentRun: {
          create: vi.fn().mockResolvedValue({
            id: 'agent-1', status: AgentRunStatus.RUNNING, errorMessage: null,
          }),
          findUnique: vi.fn().mockResolvedValue({ status: AgentRunStatus.RUNNING }),
          updateMany,
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'agent-1',
            status: 'CANCELLED',
            errorMessage: 'stop',
            estimatedCost: 0,
          }),
        },
        agentMessage: { createMany: createMessages },
      };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    const executor = new AgentExecutor({
      prisma,
      registry: { resolve: resolveProvider },
      logger: {
        withContext: vi.fn().mockReturnValue({
          info: vi.fn(),
          error: vi.fn(),
        }),
      },
      env: {},
      audit: { record: recordAudit },
      usage: {
        budgetExceeded: vi.fn().mockResolvedValue({ exceeded: false, spent: 0, limit: 5 }),
        record: recordUsage,
      },
      contextBuilder: {
        resolveRoleProvider: vi.fn().mockResolvedValue({
          providerKey: 'mock',
          agentId: null,
          model: null,
        }),
        build: vi.fn().mockResolvedValue({}),
      },
    } as never);

    await expect(
      executor.execute({
        taskId: 'task-1',
        role: AgentRole.IMPLEMENTER,
        input: {},
        workspacePath: 'C:\\worktree',
        traceId: 'trace-1',
      }),
    ).resolves.toMatchObject({ status: AgentRunStatus.CANCELLED, output: null });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'agent-1', status: AgentRunStatus.RUNNING },
      }),
    );
    expect(createMessages).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledOnce();
  });

  it('skips provider start when its workflow was cancelled during context preparation', async () => {
    const startRun = vi.fn();
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ status: TaskStatus.IMPLEMENTING }]),
        $transaction: vi.fn(),
        task: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'task-1', key: 'ENG-1', projectId: 'project-1',
            project: { organizationId: 'org-1' },
          }),
          findUnique: vi.fn().mockResolvedValue({ status: TaskStatus.IMPLEMENTING }),
        },
        workflowRun: { findUnique: vi.fn()
          .mockResolvedValueOnce({ projectId: 'project-1', taskId: 'task-1' })
          .mockResolvedValueOnce({ status: RunStatus.RUNNING })
          .mockResolvedValueOnce({ status: RunStatus.CANCELLED }),
        },
        agentProvider: { findFirst: vi.fn().mockResolvedValue({ id: 'provider-1' }) },
        agentRun: {
          create: vi.fn().mockResolvedValue({
            id: 'agent-1', status: AgentRunStatus.RUNNING, errorMessage: null,
          }),
          findUnique: vi.fn().mockResolvedValue({ status: AgentRunStatus.RUNNING }),
          updateMany,
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'agent-1', status: AgentRunStatus.CANCELLED,
            errorMessage: 'Parent task or workflow was cancelled', estimatedCost: 0,
          }),
        },
      };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    const executor = new AgentExecutor({
      prisma,
      registry: { resolve: vi.fn().mockReturnValue({
        key: 'mock', capabilities: { models: [] }, startRun,
      }) },
      logger: { withContext: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn() }) },
      env: {},
      audit: { record: vi.fn() },
      usage: { budgetExceeded: vi.fn().mockResolvedValue({ exceeded: false, spent: 0, limit: 5 }) },
      contextBuilder: {
        resolveRoleProvider: vi.fn().mockResolvedValue({ providerKey: 'mock', agentId: null, model: null }),
        build: vi.fn().mockResolvedValue({}),
      },
    } as never);

    await expect(executor.execute({
      taskId: 'task-1', workflowRunId: 'workflow-1', role: AgentRole.IMPLEMENTER,
      input: {}, workspacePath: 'C:\\worktree', traceId: 'trace-1',
    })).resolves.toMatchObject({ status: AgentRunStatus.CANCELLED, output: null });
    expect(startRun).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'agent-1', status: AgentRunStatus.RUNNING },
      data: expect.objectContaining({ status: AgentRunStatus.CANCELLED }),
    }));
  });

  it('does not start or audit an agent when cancellation wins the creation lock', async () => {
    const startRun = vi.fn();
    const recordAudit = vi.fn();
    const create = vi.fn().mockImplementation(async ({ data }: {
      data: { status: AgentRunStatus; errorMessage?: string };
    }) => ({ id: 'agent-1', ...data }));
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ status: TaskStatus.CANCELLED }]),
      $transaction: vi.fn(),
      task: { findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'task-1', key: 'ENG-1', projectId: 'project-1',
        project: { organizationId: 'org-1' },
      }) },
      agentProvider: { findFirst: vi.fn().mockResolvedValue({ id: 'provider-1' }) },
      agentRun: { create },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    const executor = new AgentExecutor({
      prisma,
      registry: { resolve: vi.fn().mockReturnValue({
        key: 'mock', capabilities: { models: [] }, startRun,
      }) },
      logger: { withContext: vi.fn() },
      env: {},
      audit: { record: recordAudit },
      usage: { budgetExceeded: vi.fn().mockResolvedValue({ exceeded: false, spent: 0, limit: 5 }) },
      contextBuilder: { resolveRoleProvider: vi.fn().mockResolvedValue({
        providerKey: 'mock', agentId: null, model: null,
      }) },
    } as never);

    await expect(executor.execute({
      taskId: 'task-1', role: AgentRole.IMPLEMENTER, input: {},
      workspacePath: 'C:\\worktree', traceId: 'trace-1',
    })).resolves.toMatchObject({ status: AgentRunStatus.CANCELLED, output: null });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AgentRunStatus.CANCELLED }),
    }));
    expect(startRun).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('records cancellation instead of budget exhaustion when cancellation wins that creation lock', async () => {
    const create = vi.fn().mockImplementation(async ({ data }: {
      data: { status: AgentRunStatus; errorMessage: string };
    }) => ({ id: 'agent-1', ...data }));
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ status: TaskStatus.CANCELLED }]),
      $transaction: vi.fn(),
      task: { findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'task-1', key: 'ENG-1', projectId: 'project-1',
        project: { organizationId: 'org-1' },
      }) },
      agentProvider: { findFirst: vi.fn().mockResolvedValue({ id: 'provider-1' }) },
      agentRun: { create },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    const executor = new AgentExecutor({
      prisma,
      registry: { resolve: vi.fn() },
      logger: { warn: vi.fn() },
      env: {},
      audit: { record: vi.fn() },
      usage: { budgetExceeded: vi.fn().mockResolvedValue({ exceeded: true, spent: 5, limit: 5 }) },
      contextBuilder: { resolveRoleProvider: vi.fn().mockResolvedValue({
        providerKey: 'mock', agentId: null, model: null,
      }) },
    } as never);

    await expect(executor.execute({
      taskId: 'task-1', role: AgentRole.IMPLEMENTER, input: {},
      workspacePath: 'C:\\worktree', traceId: 'trace-1',
    })).resolves.toMatchObject({
      status: AgentRunStatus.CANCELLED,
      budgetExceeded: false,
      error: 'Parent task or workflow was cancelled',
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: AgentRunStatus.CANCELLED,
        errorCode: null,
      }),
    }));
  });

  it('rejects a resolved agent outside the task tenant before creating a run', async () => {
    const create = vi.fn();
    const executor = new AgentExecutor({
      prisma: {
        task: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'task-1',
            key: 'ENG-1',
            projectId: 'project-1',
            project: { organizationId: 'org-1' },
          }),
        },
        agentProvider: { findFirst: vi.fn().mockResolvedValue({ id: 'provider-1' }) },
        agent: { findFirst: vi.fn().mockResolvedValue(null) },
        agentRun: { create },
      },
      registry: {},
      logger: {},
      env: {},
      audit: {},
      usage: {},
      contextBuilder: {
        resolveRoleProvider: vi.fn().mockResolvedValue({
          providerKey: 'codex',
          agentId: 'foreign-agent',
          model: null,
        }),
      },
    } as never);

    await expect(
      executor.execute({
        taskId: 'task-1',
        role: AgentRole.IMPLEMENTER,
        input: {},
        workspacePath: 'C:\\worktree',
        traceId: 'trace-1',
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(create).not.toHaveBeenCalled();
  });
});
