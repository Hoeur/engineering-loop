import { Injectable } from '@nestjs/common';
import { AgentProviderKind, AuditAction, OrgRole } from '@engloop/types';
import { MODEL_PRICING } from '@engloop/agent-sdk';
import type { UpsertAgentProviderDto } from '@engloop/schemas';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

/**
 * Provider registry management.
 *
 * Credentials are write-only from the API's perspective: they go in encrypted
 * and only ever come back as a redacted preview (spec section 21 — "do not
 * expose provider API keys to the frontend").
 */
@Injectable()
export class AgentProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertAdministrator(role: string): void {
    if (role !== OrgRole.OWNER && role !== OrgRole.ADMIN) {
      throw AppError.forbidden('Only organization owners and administrators can manage providers');
    }
  }

  async list(organizationId: string) {
    const providers = await this.prisma.agentProvider.findMany({
      where: { organizationId },
      orderBy: { displayName: 'asc' },
      include: { _count: { select: { agents: true, agentRuns: true } } },
    });

    const items = providers.map((provider) => ({
      ...provider,
      encryptedCredential: undefined,
      credentialIv: undefined,
      credentialAuthTag: undefined,
      hasCredential: Boolean(provider.encryptedCredential),
      requiresCredential: false,
      credentialSource:
        provider.kind === AgentProviderKind.MOCK ? 'none' : 'worker-process-environment',
    }));

    return { items, meta: { catalogue: MODEL_PRICING } };
  }

  async upsert(organizationId: string, role: string, dto: UpsertAgentProviderDto) {
    this.assertAdministrator(role);
    if (dto.credential) {
      throw AppError.badRequest(
        'PROVIDER_CREDENTIAL_UNSUPPORTED',
        'Provider credentials must be configured in the worker process environment',
      );
    }

    const provider = await this.prisma.agentProvider.upsert({
      where: { organizationId_key: { organizationId, key: dto.key } },
      create: {
        organizationId,
        key: dto.key,
        displayName: dto.displayName,
        kind: dto.kind,
        enabled: dto.enabled,
        defaultModel: dto.defaultModel ?? null,
        availableModels: dto.availableModels,
        configuration: dto.configuration as Prisma.InputJsonValue,
        pricing: (dto.pricing ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        displayName: dto.displayName,
        kind: dto.kind,
        enabled: dto.enabled,
        defaultModel: dto.defaultModel ?? null,
        availableModels: dto.availableModels,
        configuration: dto.configuration as Prisma.InputJsonValue,
        ...(dto.pricing ? { pricing: dto.pricing as Prisma.InputJsonValue } : {}),
      },
    });

    await this.audit.recordSafe({
      organizationId,
      action: AuditAction.CONFIGURATION_CHANGED,
      entityType: 'agent_provider',
      entityId: provider.id,
      summary: `Configured provider ${provider.key}`,
      metadata: { credentialSource: 'worker-process-environment' },
    });

    return {
      ...provider,
      encryptedCredential: undefined,
      credentialIv: undefined,
      credentialAuthTag: undefined,
      hasCredential: Boolean(provider.encryptedCredential),
    };
  }

  /**
   * Health is reported from the worker's last probe: only the worker process
   * loads credentials and can actually reach a provider CLI.
   */
  async health(organizationId: string) {
    const providers = await this.prisma.agentProvider.findMany({
      where: { organizationId },
      select: {
        key: true,
        displayName: true,
        kind: true,
        enabled: true,
        healthy: true,
        lastHealthCheckAt: true,
        lastHealthDetail: true,
      },
    });
    return { items: providers, meta: {} };
  }

  async remove(organizationId: string, role: string, key: string) {
    this.assertAdministrator(role);
    const provider = await this.prisma.agentProvider.findUnique({
      where: { organizationId_key: { organizationId, key } },
      include: { _count: { select: { agents: true } } },
    });
    if (!provider) throw AppError.notFound('AgentProvider', key);
    if (provider._count.agents > 0) {
      throw AppError.conflict(
        'CONFLICT',
        `Provider ${key} still has ${String(provider._count.agents)} agent(s) bound to it`,
      );
    }
    await this.prisma.agentProvider.delete({ where: { id: provider.id } });
    return { deleted: true, key };
  }
}
