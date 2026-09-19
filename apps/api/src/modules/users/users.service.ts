import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId?: string) {
    const items = await this.prisma.user.findMany({
      where: organizationId ? { memberships: { some: { organizationId } } } : {},
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        isSystem: true,
        lastLoginAt: true,
        memberships: { select: { organizationId: true, role: true } },
      },
    });
    return { items, meta: {} };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        createdAt: true,
        memberships: {
          include: { organization: { select: { id: true, name: true, slug: true } } },
        },
      },
    });
    if (!user) throw AppError.notFound('User', id);
    return user;
  }
}
