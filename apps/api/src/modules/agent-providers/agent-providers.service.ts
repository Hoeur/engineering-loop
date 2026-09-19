import { Injectable } from '@nestjs/common';
import { AgentProviderKind, AuditAction, OrgRole } from '@engloop/types';
import { MODEL_PRICING } from '@engloop/agent-sdk';
import type { UpsertAgentProviderDto } from '@engloop/schemas';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { SecretsService } from '../../infrastructure/crypto/secrets.service';

/** How a provider authenticates at run time, as reported to the UI. */
type CredentialSource = 'none' | 'database' | 'cli-login';

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
    private readonly secrets: SecretsService,
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
      ...this.withoutCredential(provider),
      hasCredential: Boolean(provider.encryptedCredential),
      // Only real CLI providers can carry a key; a run without one falls back to
      // the CLI's own login rather than failing.
      requiresCredential: provider.kind !== AgentProviderKind.MOCK,
      credentialSource: AgentProvidersService.credentialSource(provider),
    }));

    return { items, meta: { catalogue: MODEL_PRICING } };
  }

  async upsert(organizationId: string, role: string, dto: UpsertAgentProviderDto) {
    this.assertAdministrator(role);

    if (dto.credential && dto.kind === AgentProviderKind.MOCK) {
      throw AppError.badRequest(
        'PROVIDER_CREDENTIAL_UNSUPPORTED',
        'The mock provider does not authenticate and cannot store a credential',
      );
    }

    // Three states: set a new key, clear the stored one, or leave it alone.
    // "Leave it alone" must omit the columns entirely so editing an unrelated
    // field does not wipe a working credential.
    const credentialColumns = dto.credential
      ? (() => {
          const encrypted = this.secrets.encrypt(dto.credential);
          return {
            encryptedCredential: encrypted.ciphertext,
            credentialIv: encrypted.iv,
            credentialAuthTag: encrypted.authTag,
          };
        })()
      : dto.clearCredential
        ? { encryptedCredential: null, credentialIv: null, credentialAuthTag: null }
        : {};

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
        ...credentialColumns,
      },
      update: {
        displayName: dto.displayName,
        kind: dto.kind,
        enabled: dto.enabled,
        defaultModel: dto.defaultModel ?? null,
        availableModels: dto.availableModels,
        configuration: dto.configuration as Prisma.InputJsonValue,
        ...(dto.pricing ? { pricing: dto.pricing as Prisma.InputJsonValue } : {}),
        ...credentialColumns,
      },
    });

    const credentialChange = dto.credential ? 'set' : dto.clearCredential ? 'cleared' : 'unchanged';

    await this.audit.recordSafe({
      organizationId,
      action: AuditAction.CONFIGURATION_CHANGED,
      entityType: 'agent_provider',
      entityId: provider.id,
      summary: `Configured provider ${provider.key}`,
      // Records that a credential changed — never the value or its preview.
      metadata: { credentialChange },
    });

    return {
      ...this.withoutCredential(provider),
      hasCredential: Boolean(provider.encryptedCredential),
      requiresCredential: provider.kind !== AgentProviderKind.MOCK,
      credentialSource: AgentProvidersService.credentialSource(provider),
      // Shown once so an admin can confirm the key they pasted. Derived from the
      // submitted plaintext, never by decrypting what is stored.
      credentialPreview: dto.credential ? this.secrets.redact(dto.credential) : null,
    };
  }

  /** Strips every ciphertext column from a row before it leaves the API. */
  private withoutCredential<T extends object>(
    provider: T,
  ): Omit<T, 'encryptedCredential' | 'credentialIv' | 'credentialAuthTag'> {
    const { encryptedCredential, credentialIv, credentialAuthTag, ...safe } = provider as T & {
      encryptedCredential?: unknown;
      credentialIv?: unknown;
      credentialAuthTag?: unknown;
    };
    void encryptedCredential;
    void credentialIv;
    void credentialAuthTag;
    return safe;
  }

  private static credentialSource(provider: {
    kind: AgentProviderKind;
    encryptedCredential: string | null;
  }): CredentialSource {
    if (provider.kind === AgentProviderKind.MOCK) return 'none';
    return provider.encryptedCredential ? 'database' : 'cli-login';
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
