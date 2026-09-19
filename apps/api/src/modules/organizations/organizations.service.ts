import { Injectable } from '@nestjs/common';
import type { CreateOrganizationDto } from '@engloop/schemas';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { projects: true, members: true, agents: true } } },
    });
    return { items, meta: {} };
  }

  async findOne(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
        },
        projects: { select: { id: true, name: true, slug: true, key: true, status: true } },
        _count: { select: { agents: true, agentProviders: true } },
      },
    });
    if (!org) throw AppError.notFound('Organization', id);
    return org;
  }

  create(dto: CreateOrganizationDto) {
    return this.prisma.organization.create({ data: dto });
  }
}
