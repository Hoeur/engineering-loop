import { Injectable } from '@nestjs/common';
import type { CreateFeatureDto } from '@engloop/schemas';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId?: string, epicId?: string) {
    const items = await this.prisma.feature.findMany({
      where: { ...(projectId ? { projectId } : {}), ...(epicId ? { epicId } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { tasks: true } }, epic: { select: { id: true, title: true } } },
    });
    return { items, meta: {} };
  }

  async findOne(id: string) {
    const feature = await this.prisma.feature.findUnique({
      where: { id },
      include: {
        tasks: { select: { id: true, key: true, title: true, status: true } },
        epic: true,
      },
    });
    if (!feature) throw AppError.notFound('Feature', id);
    return feature;
  }

  create(dto: CreateFeatureDto) {
    return this.prisma.feature.create({
      data: {
        projectId: dto.projectId,
        epicId: dto.epicId ?? null,
        title: dto.title,
        description: dto.description ?? null,
        status: dto.status,
      },
    });
  }
}
