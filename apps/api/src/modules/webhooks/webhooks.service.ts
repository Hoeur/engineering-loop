import { Inject, Injectable } from '@nestjs/common';
import { verifyGitHubWebhook } from '@engloop/github';
import type { Prisma } from '@engloop/db';
import type { EngLoopLogger } from '@engloop/logger';
import { PullRequestStatus, RepositoryStatus, WebhookEventStatus } from '@engloop/types';
import { AppError } from '../../common/errors/app-error';
import { AppConfigService } from '../../infrastructure/config/config.service';
import { LOGGER } from '../../infrastructure/logger/logger.tokens';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(LOGGER) private readonly logger: EngLoopLogger,
  ) {}

  async receiveGitHub(input: {
    rawBody: Buffer | undefined;
    signature: string | undefined;
    eventType: string;
    deliveryId: string | undefined;
    payload: Record<string, unknown>;
  }) {
    const secret = this.config.env.GITHUB_WEBHOOK_SECRET;
    if (!secret)
      throw AppError.dependencyUnavailable('GitHub webhook integration is not configured');
    if (!input.rawBody || !verifyGitHubWebhook(input.rawBody, input.signature, secret)) {
      throw AppError.unauthorized('Invalid GitHub webhook signature');
    }
    if (!input.deliveryId)
      throw AppError.badRequest('GITHUB_DELIVERY_ID_REQUIRED', 'GitHub delivery id is required');

    const installationId = nestedId(input.payload, 'installation');
    if (!installationId) return { ignored: true, reason: 'installation_missing' };
    const installation = await this.prisma.gitHubInstallation.findUnique({
      where: { externalId: installationId },
      select: { id: true, organizationId: true },
    });
    if (!installation) {
      this.logger.warn(
        { installationId, deliveryId: input.deliveryId },
        'webhook.github.unbound-installation',
      );
      return { ignored: true, reason: 'installation_not_connected' };
    }

    const existing = await this.prisma.webhookEvent.findUnique({
      where: { source_externalId: { source: 'github', externalId: input.deliveryId } },
    });
    let eventId: string;
    if (existing) {
      const retryable =
        existing.status === WebhookEventStatus.FAILED || isStaleReceived(existing, new Date());
      if (!retryable) {
        return { duplicate: true, id: existing.id, status: existing.status };
      }
      const claimed = await this.prisma.webhookEvent.updateMany({
        where: {
          id: existing.id,
          status: existing.status,
          ...(existing.status === WebhookEventStatus.RECEIVED ? { processedAt: null } : {}),
        },
        data: { status: WebhookEventStatus.RECEIVED, error: null, processedAt: null },
      });
      if (claimed.count !== 1) {
        return { duplicate: true, id: existing.id, status: existing.status };
      }
      eventId = existing.id;
    } else {
      try {
        const created = await this.prisma.webhookEvent.create({
          data: {
            organizationId: installation.organizationId,
            source: 'github',
            eventType: input.eventType,
            externalId: input.deliveryId,
            payload: input.payload as Prisma.InputJsonValue,
            signatureValid: true,
            status: WebhookEventStatus.RECEIVED,
          },
        });
        eventId = created.id;
      } catch (error) {
        if (isUniqueConstraint(error)) {
          const duplicate = await this.prisma.webhookEvent.findUnique({
            where: { source_externalId: { source: 'github', externalId: input.deliveryId } },
          });
          if (duplicate) return { duplicate: true, id: duplicate.id, status: duplicate.status };
        }
        throw error;
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const processed = await this.processGitHubEvent(
          tx,
          installation.id,
          installationId,
          input.eventType,
          input.payload,
        );
        const status = processed ? WebhookEventStatus.PROCESSED : WebhookEventStatus.IGNORED;
        await tx.webhookEvent.update({
          where: { id: eventId },
          data: { status, processedAt: new Date() },
        });
        return { duplicate: false, id: eventId, status };
      });
    } catch (error) {
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: {
          status: WebhookEventStatus.FAILED,
          error: safeError(error),
          processedAt: new Date(),
        },
      }).catch(() => undefined);
      this.logger.error(
        { deliveryId: input.deliveryId, eventType: input.eventType },
        'webhook.github.processing-failed',
      );
      throw AppError.internal('GitHub webhook processing failed');
    }
  }

  async list(organizationId: string, limit = 50) {
    const items = await this.prisma.webhookEvent.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        source: true,
        eventType: true,
        externalId: true,
        status: true,
        signatureValid: true,
        error: true,
        createdAt: true,
        processedAt: true,
      },
    });
    return { items, meta: {} };
  }

  private async processGitHubEvent(
    db: Prisma.TransactionClient,
    installationRecordId: string,
    installationId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    if (eventType === 'pull_request') return this.syncPullRequest(db, installationRecordId, payload);
    if (eventType === 'repository') return this.syncRepository(db, installationRecordId, payload);
    if (eventType === 'push') return this.syncPush(db, installationRecordId, payload);
    if (eventType === 'installation_repositories') {
      return this.syncInstallationRepositories(db, installationRecordId, payload);
    }
    if (eventType === 'installation') {
      const action = typeof payload.action === 'string' ? payload.action : '';
      const suspendedAt =
        action === 'suspend' || action === 'deleted'
          ? new Date()
          : action === 'unsuspend'
            ? null
            : undefined;
      if (suspendedAt === undefined) return false;
      await db.gitHubInstallation.update({
        where: { externalId: installationId },
        data: { suspendedAt },
      });
      await db.repository.updateMany({
        where: { githubInstallationRecordId: installationRecordId },
        data: {
          status:
            action === 'unsuspend'
              ? RepositoryStatus.CONNECTED
              : RepositoryStatus.DISCONNECTED,
          lastSyncedAt: new Date(),
        },
      });
      return true;
    }
    return false;
  }

  private async syncRepository(
    db: Prisma.TransactionClient,
    installationRecordId: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const repository = asRecord(payload.repository);
    if (!repository) return false;
    const repositoryId = idString(repository.id);
    if (!repositoryId) return false;
    const owner = asRecord(repository.owner);
    const result = await db.repository.updateMany({
      where: { githubInstallationRecordId: installationRecordId, githubRepositoryId: repositoryId },
      data: {
        name: stringValue(repository.name) ?? undefined,
        remoteUrl: stringValue(repository.clone_url) ?? undefined,
        defaultBranch: stringValue(repository.default_branch) ?? undefined,
        primaryLanguage: nullableString(repository.language),
        githubNodeId: stringValue(repository.node_id) ?? undefined,
        githubOwner: owner ? stringValue(owner.login) : undefined,
        githubFullName: stringValue(repository.full_name) ?? undefined,
        githubPrivate: typeof repository.private === 'boolean' ? repository.private : undefined,
        githubArchived: repository.archived === true,
        githubHtmlUrl: stringValue(repository.html_url) ?? undefined,
        lastSyncedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  private async syncPullRequest(
    db: Prisma.TransactionClient,
    installationRecordId: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const repositoryPayload = asRecord(payload.repository);
    const pull = asRecord(payload.pull_request);
    if (!repositoryPayload || !pull) return false;
    const githubRepositoryId = idString(repositoryPayload.id);
    const number = typeof pull.number === 'number' ? pull.number : undefined;
    if (!githubRepositoryId || !number) return false;
    const repository = await db.repository.findFirst({
      where: { githubInstallationRecordId: installationRecordId, githubRepositoryId },
      select: { id: true },
    });
    if (!repository) return false;
    const head = asRecord(pull.head);
    const base = asRecord(pull.base);
    const merged = pull.merged === true || typeof pull.merged_at === 'string';
    const closed = pull.state === 'closed';
    const draft = pull.draft === true;
    const status = merged
      ? PullRequestStatus.MERGED
      : closed
        ? PullRequestStatus.CLOSED
        : draft
          ? PullRequestStatus.DRAFT
          : PullRequestStatus.OPEN;
    await db.pullRequest.upsert({
      where: { repositoryId_number: { repositoryId: repository.id, number } },
      create: {
        repositoryId: repository.id,
        number,
        title: stringValue(pull.title) ?? `Pull request #${number}`,
        body: stringValue(pull.body) ?? '',
        status,
        url: stringValue(pull.html_url),
        headBranch: (head && stringValue(head.ref)) ?? 'unknown',
        baseBranch: (base && stringValue(base.ref)) ?? 'unknown',
        draft,
        local: false,
        mergedAt: dateValue(pull.merged_at),
        closedAt: dateValue(pull.closed_at),
      },
      update: {
        title: stringValue(pull.title) ?? undefined,
        body: stringValue(pull.body) ?? '',
        status,
        url: stringValue(pull.html_url),
        headBranch: (head && stringValue(head.ref)) ?? undefined,
        baseBranch: (base && stringValue(base.ref)) ?? undefined,
        draft,
        local: false,
        mergedAt: dateValue(pull.merged_at),
        closedAt: dateValue(pull.closed_at),
      },
    });
    return true;
  }

  private async syncPush(
    db: Prisma.TransactionClient,
    installationRecordId: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const repositoryPayload = asRecord(payload.repository);
    const reference = stringValue(payload.ref);
    if (!repositoryPayload || !reference?.startsWith('refs/heads/')) return false;
    const githubRepositoryId = idString(repositoryPayload.id);
    if (!githubRepositoryId) return false;
    const repository = await db.repository.findFirst({
      where: { githubInstallationRecordId: installationRecordId, githubRepositoryId },
      select: { id: true, defaultBranch: true },
    });
    if (!repository) return false;
    await this.syncRepository(db, installationRecordId, payload);
    const branchName = reference.slice('refs/heads/'.length);
    await db.gitBranch.upsert({
      where: { repositoryId_name: { repositoryId: repository.id, name: branchName } },
      create: {
        repositoryId: repository.id,
        name: branchName,
        baseBranch: repository.defaultBranch,
        headSha: stringValue(payload.after),
        pushed: true,
      },
      update: { headSha: stringValue(payload.after), pushed: true },
    });
    return true;
  }

  private async syncInstallationRepositories(
    db: Prisma.TransactionClient,
    installationRecordId: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const added = Array.isArray(payload.repositories_added) ? payload.repositories_added : [];
    const removed = Array.isArray(payload.repositories_removed) ? payload.repositories_removed : [];
    let changed = false;
    for (const value of added) {
      const repository = asRecord(value);
      const repositoryId = repository ? idString(repository.id) : null;
      if (!repository || !repositoryId) continue;
      const owner = asRecord(repository.owner);
      const result = await db.repository.updateMany({
        where: { githubInstallationRecordId: installationRecordId, githubRepositoryId: repositoryId },
        data: {
          status: RepositoryStatus.CONNECTED,
          name: stringValue(repository.name) ?? undefined,
          githubFullName: stringValue(repository.full_name) ?? undefined,
          githubOwner: owner ? stringValue(owner.login) : undefined,
          githubPrivate: typeof repository.private === 'boolean' ? repository.private : undefined,
          githubArchived: repository.archived === true,
          lastSyncedAt: new Date(),
        },
      });
      changed ||= result.count > 0;
    }
    for (const value of removed) {
      const repository = asRecord(value);
      const repositoryId = repository ? idString(repository.id) : null;
      if (!repositoryId) continue;
      const result = await db.repository.updateMany({
        where: { githubInstallationRecordId: installationRecordId, githubRepositoryId: repositoryId },
        data: { status: RepositoryStatus.DISCONNECTED, lastSyncedAt: new Date() },
      });
      changed ||= result.count > 0;
    }
    return changed;
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
const idString = (value: unknown): string | null =>
  typeof value === 'number' || typeof value === 'string' ? String(value) : null;
const nestedId = (payload: Record<string, unknown>, key: string): string | null => {
  const nested = asRecord(payload[key]);
  return nested ? idString(nested.id) : null;
};
const stringValue = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const nullableString = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === 'string' ? value : undefined;
const dateValue = (value: unknown): Date | null =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value) : null;
const isUniqueConstraint = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002');
const safeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'Webhook processing failed';
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 500);
};
const isStaleReceived = (
  event: { status: string; processedAt?: Date | null; createdAt?: Date },
  now: Date,
): boolean =>
  event.status === WebhookEventStatus.RECEIVED &&
  event.processedAt == null &&
  event.createdAt instanceof Date &&
  now.getTime() - event.createdAt.getTime() >= 30_000;
