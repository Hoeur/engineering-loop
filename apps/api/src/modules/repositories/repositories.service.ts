import { Injectable } from '@nestjs/common';
import type { UpdateRepositoryDto } from './repositories.types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SecretsService } from '../../infrastructure/crypto/secrets.service';
import { AppError } from '../../common/errors/app-error';
import { OrgRole, RepositoryProvider } from '@engloop/types';

const MANAGER_ROLES = new Set<string>([OrgRole.OWNER, OrgRole.ADMIN]);

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
  ) {}

  async list(organizationId: string, projectId?: string) {
    const items = await this.prisma.repository.findMany({
      where: {
        project: { organizationId },
        ...(projectId ? { projectId } : {}),
      },
      orderBy: { name: 'asc' },
      include: {
        project: { select: { id: true, name: true, key: true } },
        _count: { select: { tasks: true, worktrees: true, pullRequests: true, branches: true } },
      },
    });
    return { items, meta: {} };
  }

  async findOne(organizationId: string, id: string) {
    const repository = await this.prisma.repository.findFirst({
      where: { id, project: { organizationId } },
      include: {
        project: { select: { id: true, name: true, key: true, organizationId: true } },
        worktrees: { orderBy: { createdAt: 'desc' }, take: 20 },
        branches: { orderBy: { updatedAt: 'desc' }, take: 20 },
        pullRequests: { orderBy: { createdAt: 'desc' }, take: 20 },
        credentials: {
          select: { id: true, name: true, kind: true, lastUsedAt: true, createdAt: true },
        },
      },
    });
    if (!repository) throw AppError.notFound('Repository', id);
    return repository;
  }

  async update(organizationId: string, role: string, id: string, dto: UpdateRepositoryDto) {
    this.assertManager(role);
    const existing = await this.findOwned(organizationId, id);
    if (
      existing.provider === RepositoryProvider.GITHUB &&
      [
        dto.name,
        dto.provider,
        dto.remoteUrl,
        dto.localPath,
        dto.defaultBranch,
        dto.primaryLanguage,
        dto.installationId,
      ].some((value) => value !== undefined)
    ) {
      throw AppError.conflict(
        'GITHUB_CANONICAL_FIELDS_READ_ONLY',
        'GitHub identity and repository metadata are synchronized from GitHub',
      );
    }
    if (dto.provider === RepositoryProvider.GITHUB || dto.installationId) {
      throw AppError.conflict(
        'GITHUB_IMPORT_REQUIRED',
        'GitHub repositories must be imported through the verified GitHub App flow',
      );
    }
    return this.prisma.repository.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.remoteUrl !== undefined ? { remoteUrl: dto.remoteUrl } : {}),
        ...(dto.localPath !== undefined ? { localPath: dto.localPath } : {}),
        ...(dto.defaultBranch !== undefined ? { defaultBranch: dto.defaultBranch } : {}),
        ...(dto.primaryLanguage !== undefined ? { primaryLanguage: dto.primaryLanguage } : {}),
        ...(dto.frameworks !== undefined ? { frameworks: dto.frameworks } : {}),
        ...(dto.packageManager !== undefined ? { packageManager: dto.packageManager } : {}),
        ...(dto.commands !== undefined ? { commands: dto.commands } : {}),
      },
    });
  }

  /** Stores a token as AES-256-GCM ciphertext; the plaintext is never returned. */
  async addCredential(
    organizationId: string,
    role: string,
    repositoryId: string,
    name: string,
    kind: string,
    value: string,
  ) {
    this.assertManager(role);
    const repository = await this.findOwned(organizationId, repositoryId);
    if (repository.provider === RepositoryProvider.GITHUB) {
      throw AppError.conflict(
        'GITHUB_APP_CREDENTIALS_REQUIRED',
        'GitHub repositories use short-lived GitHub App credentials',
      );
    }
    const encrypted = this.secrets.encrypt(value);
    const credential = await this.prisma.repositoryCredential.create({
      data: {
        repositoryId,
        name,
        kind,
        encryptedValue: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
      select: { id: true, name: true, kind: true, createdAt: true },
    });
    return { ...credential, preview: this.secrets.redact(value) };
  }

  private async findOwned(organizationId: string, id: string) {
    const repository = await this.prisma.repository.findFirst({
      where: { id, project: { organizationId } },
      select: { id: true, provider: true },
    });
    if (!repository) throw AppError.notFound('Repository', id);
    return repository;
  }

  private assertManager(role: string): void {
    if (!MANAGER_ROLES.has(role)) {
      throw AppError.forbidden(
        'Only organization owners and administrators can manage repositories',
      );
    }
  }
}
