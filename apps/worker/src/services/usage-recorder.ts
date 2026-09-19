import type { AgentRole } from '@engloop/types';
import { toDateOnly, type PrismaClient } from '@engloop/db';

export interface UsageInput {
  organizationId: string;
  projectId?: string | null;
  taskId?: string | null;
  agentRunId: string;
  providerKey: string;
  model?: string | null;
  role: AgentRole;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  durationMs: number;
  estimatedCostUsd: number;
}

/** Writes the paired usage + cost rows that power the Insights dashboards. */
export class UsageRecorder {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: UsageInput): Promise<void> {
    const occurredOn = toDateOnly();

    await this.prisma.$transaction([
      this.prisma.usageRecord.create({
        data: {
          organizationId: input.organizationId,
          projectId: input.projectId ?? null,
          taskId: input.taskId ?? null,
          agentRunId: input.agentRunId,
          providerKey: input.providerKey,
          model: input.model ?? null,
          role: input.role,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          cachedTokens: input.cachedTokens,
          totalTokens: input.totalTokens,
          durationMs: input.durationMs,
          occurredOn,
        },
      }),
      this.prisma.costRecord.create({
        data: {
          organizationId: input.organizationId,
          projectId: input.projectId ?? null,
          taskId: input.taskId ?? null,
          agentRunId: input.agentRunId,
          providerKey: input.providerKey,
          model: input.model ?? null,
          estimatedCost: input.estimatedCostUsd,
          occurredOn,
        },
      }),
    ]);

    if (input.taskId) {
      await this.prisma.task.update({
        where: { id: input.taskId },
        data: { actualCost: { increment: input.estimatedCostUsd } },
      });
    }
  }

  /** Returns true when the task or project has burned through its budget. */
  async budgetExceeded(
    taskId: string,
  ): Promise<{ exceeded: boolean; spent: number; limit: number }> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { actualCost: true, project: { select: { costBudgetUsd: true } } },
    });
    if (!task) return { exceeded: false, spent: 0, limit: 0 };

    const spent = Number(task.actualCost);
    const limit = Number(task.project.costBudgetUsd);
    return { exceeded: limit > 0 && spent >= limit, spent, limit };
  }
}
