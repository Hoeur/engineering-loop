import { Injectable } from '@nestjs/common';
import {
  ApprovalStatus,
  AuditAction,
  PERMISSION_LEVEL_ORDER,
  type PermissionLevel,
} from '@engloop/types';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, filters: { projectId?: string; status?: string }) {
    const where: Prisma.ApprovalWhereInput = {
      AND: [
        { project: { organizationId } },
        { OR: [{ taskId: null }, { task: { project: { organizationId } } }] },
        {
          OR: [
            { workflowRunId: null },
            {
              workflowRun: {
                project: { organizationId },
                OR: [{ taskId: null }, { task: { project: { organizationId } } }],
              },
            },
          ],
        },
      ],
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.status ? { status: filters.status as ApprovalStatus } : {}),
    };
    const candidates = await this.prisma.approval.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        task: { select: { id: true, key: true, title: true, status: true, projectId: true } },
        workflowRun: {
          select: {
            projectId: true,
            task: { select: { projectId: true, project: { select: { organizationId: true } } } },
          },
        },
        project: { select: { id: true, name: true, key: true } },
        requestedBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
      },
    });
    const items = candidates
      .filter((approval) => this.hasConsistentOwners(approval, organizationId))
      .map(({ workflowRun: _workflowRun, task, ...approval }) => ({
        ...approval,
        task: task
          ? { id: task.id, key: task.key, title: task.title, status: task.status }
          : null,
      }));
    return { items, meta: {} };
  }

  async decide(
    organizationId: string,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    note: string | undefined,
    userId?: string,
  ) {
    const approval = await this.prisma.approval.findFirst({
      where: {
        id,
        AND: [
          { project: { organizationId } },
          { OR: [{ taskId: null }, { task: { project: { organizationId } } }] },
          {
            OR: [
              { workflowRunId: null },
              {
                workflowRun: {
                  project: { organizationId },
                  OR: [{ taskId: null }, { task: { project: { organizationId } } }],
                },
              },
            ],
          },
        ],
      },
      include: {
        project: { select: { organizationId: true } },
        task: { select: { projectId: true } },
        workflowRun: {
          select: {
            projectId: true,
            task: { select: { projectId: true, project: { select: { organizationId: true } } } },
          },
        },
      },
    });
    if (!approval) throw AppError.notFound('Approval', id);
    if (!this.hasConsistentOwners(approval, organizationId)) {
      throw AppError.notFound('Approval', id);
    }
    if (approval.status !== ApprovalStatus.PENDING) {
      throw AppError.conflict('CONFLICT', `Approval is already ${approval.status}`);
    }

    const claimed = await this.prisma.approval.updateMany({
      where: { id, status: ApprovalStatus.PENDING },
      data: {
        status: decision,
        note: note ?? null,
        decidedById: userId ?? null,
        decidedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      throw AppError.conflict('CONFLICT', 'Approval was decided by another request');
    }

    await this.audit.recordSafe({
      organizationId: approval.project.organizationId,
      projectId: approval.projectId,
      taskId: approval.taskId,
      action: AuditAction.APPROVAL_DECISION,
      entityType: 'approval',
      entityId: id,
      summary: `Approval ${approval.kind} ${decision.toLowerCase()}`,
      metadata: { note: note ?? null },
    });

    return this.prisma.approval.findUniqueOrThrow({ where: { id } });
  }

  private hasConsistentOwners(
    approval: {
      projectId: string;
      task: { projectId: string } | null;
      workflowRun: {
        projectId: string;
        task: { projectId: string; project: { organizationId: string } } | null;
      } | null;
    },
    organizationId: string,
  ): boolean {
    if (approval.task && approval.task.projectId !== approval.projectId) return false;
    if (approval.workflowRun?.projectId !== undefined) {
      if (approval.workflowRun.projectId !== approval.projectId) return false;
      if (
        approval.workflowRun.task &&
        (approval.workflowRun.task.projectId !== approval.projectId ||
          approval.workflowRun.task.project.organizationId !== organizationId)
      ) {
        return false;
      }
    }
    return true;
  }

  /** Permission-level catalogue rendered by the project settings screen. */
  levels(): { level: PermissionLevel; rank: number; description: string }[] {
    const descriptions: Record<PermissionLevel, string> = {
      LEVEL_0_OBSERVE: 'Agents may inspect the repository only.',
      LEVEL_1_PLAN: 'Agents may inspect and produce plans and TODOs.',
      LEVEL_2_CODE: 'Agents may modify code inside isolated worktrees.',
      LEVEL_3_PR: 'Agents may commit, push and open pull requests.',
      LEVEL_4_MERGE: 'Agents may merge approved pull requests.',
      LEVEL_5_DEPLOY: 'Agents may trigger deployments (not implemented in the MVP).',
    };
    return PERMISSION_LEVEL_ORDER.map((level, rank) => ({
      level,
      rank,
      description: descriptions[level],
    }));
  }
}
