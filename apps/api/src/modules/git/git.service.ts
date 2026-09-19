import { Injectable } from '@nestjs/common';
import { ArtifactKind, type PullRequestStatus } from '@engloop/types';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/pagination';

/**
 * Read model over git state. All mutation happens in the worker — the API never
 * touches a working copy, which keeps the control plane free of filesystem races.
 */
@Injectable()
export class GitApiService {
  constructor(private readonly prisma: PrismaService) {}

  async listWorktrees(organizationId: string, repositoryId?: string) {
    const items = await this.prisma.gitWorktree.findMany({
      where: {
        repository: { project: { organizationId } },
        ...(repositoryId ? { repositoryId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        repository: { select: { id: true, name: true } },
        task: { select: { id: true, key: true, title: true, status: true } },
      },
    });
    return { items, meta: {} };
  }

  async listPullRequests(organizationId: string, query: {
    page: number;
    pageSize: number;
    projectId?: string;
    status?: string;
  }) {
    const where: Prisma.PullRequestWhereInput = {
      repository: {
        project: {
          organizationId,
          ...(query.projectId ? { id: query.projectId } : {}),
        },
      },
      ...(query.status ? { status: query.status as PullRequestStatus } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.pullRequest.findMany({
        where,
        ...skipTake(query.page, query.pageSize),
        orderBy: { createdAt: 'desc' },
        include: {
          repository: { select: { id: true, name: true, provider: true } },
          task: { select: { id: true, key: true, title: true, status: true } },
        },
      }),
      this.prisma.pullRequest.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  async diff(organizationId: string, taskId: string) {
    const artifact = await this.prisma.artifact.findFirst({
      where: { taskId, kind: ArtifactKind.DIFF, task: { project: { organizationId } } },
      orderBy: { createdAt: 'desc' },
    });
    if (!artifact) throw AppError.notFound('Diff artifact for task', taskId);
    return artifact;
  }

  async listCommits(organizationId: string, taskId: string) {
    const items = await this.prisma.commit.findMany({
      where: { taskId, task: { project: { organizationId } } },
      orderBy: { committedAt: 'desc' },
    });
    return { items, meta: {} };
  }
}
