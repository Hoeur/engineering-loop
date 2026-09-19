import { Injectable } from '@nestjs/common';
import type { ArtifactKind } from '@engloop/types';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { ownedArtifactWhere } from '../../common/tenant-ownership';

@Injectable()
export class ArtifactsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    organizationId: string,
    filters: { taskId?: string; agentRunId?: string; kind?: string },
  ) {
    const where: Prisma.ArtifactWhereInput = {
      ...ownedArtifactWhere(organizationId),
      ...(filters.taskId ? { taskId: filters.taskId } : {}),
      ...(filters.agentRunId ? { agentRunId: filters.agentRunId } : {}),
      ...(filters.kind ? { kind: filters.kind as ArtifactKind } : {}),
    };
    const items = await this.prisma.artifact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      // `content` can be a whole diff — excluded from list responses.
      select: {
        id: true,
        kind: true,
        name: true,
        contentType: true,
        sizeBytes: true,
        storagePath: true,
        metadata: true,
        createdAt: true,
        taskId: true,
        agentRunId: true,
        testRunId: true,
      },
    });
    return { items, meta: {} };
  }

  async findOne(organizationId: string, id: string) {
    const artifact = await this.prisma.artifact.findFirst({
      where: {
        id,
        ...ownedArtifactWhere(organizationId),
      },
    });
    if (!artifact) throw AppError.notFound('Artifact', id);
    return artifact;
  }

  async screenshots(organizationId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, project: { organizationId } },
      select: { id: true },
    });
    if (!task) throw AppError.notFound('Task', taskId);

    const items = await this.prisma.screenshot.findMany({
      where: {
        taskId,
        OR: [
          { reviewRunId: null },
          { reviewRun: { taskId, task: { project: { organizationId } } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        findings: {
          where: {
            OR: [{ taskId: null }, { taskId }],
            reviewRun: { taskId, task: { project: { organizationId } } },
          },
        },
      },
    });
    return { items, meta: {} };
  }
}
