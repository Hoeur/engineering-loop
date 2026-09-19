import { Injectable } from '@nestjs/common';
import type { CreateEpicDto } from '@engloop/schemas';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';

@Injectable()
export class EpicsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId?: string) {
    const items = await this.prisma.epic.findMany({
      where: projectId ? { projectId } : {},
      orderBy: { createdAt: 'asc' },
      include: {
        features: { select: { id: true, title: true, status: true } },
        _count: { select: { tasks: true } },
      },
    });
    return { items, meta: {} };
  }

  async findOne(id: string) {
    const epic = await this.prisma.epic.findUnique({
      where: { id },
      include: {
        features: true,
        tasks: { select: { id: true, key: true, title: true, status: true, priority: true } },
      },
    });
    if (!epic) throw AppError.notFound('Epic', id);
    return epic;
  }

  create(dto: CreateEpicDto) {
    return this.prisma.epic.create({
      data: {
        projectId: dto.projectId,
        title: dto.title,
        description: dto.description ?? null,
        status: dto.status,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
      },
    });
  }
}
