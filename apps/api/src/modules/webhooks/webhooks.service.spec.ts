import { createHmac } from 'node:crypto';
import { PullRequestStatus, WebhookEventStatus } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../infrastructure/config/config.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { EngLoopLogger } from '@engloop/logger';
import { WebhooksService } from './webhooks.service';

const secret = 'webhook-secret-that-is-at-least-32-chars';
const signed = (rawBody: Buffer): string =>
  `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

describe('WebhooksService GitHub intake', () => {
  it('rejects a signature computed over reserialized rather than exact bytes', async () => {
    const prisma = {} as PrismaService;
    const service = new WebhooksService(
      prisma,
      { env: { GITHUB_WEBHOOK_SECRET: secret } } as unknown as AppConfigService,
      { warn: vi.fn() } as unknown as EngLoopLogger,
    );
    const original = Buffer.from('{"installation":{"id":42},"x": 1}\n');
    await expect(
      service.receiveGitHub({
        rawBody: Buffer.from('{"installation":{"id":42},"x":1}'),
        signature: signed(original),
        eventType: 'ping',
        deliveryId: 'delivery-1',
        payload: { installation: { id: 42 }, x: 1 },
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('returns a durable duplicate without applying the event again', async () => {
    const rawBody = Buffer.from('{"installation":{"id":42}}');
    const prisma = {
      gitHubInstallation: {
        findUnique: vi.fn().mockResolvedValue({ id: 'installation-record', organizationId: 'org-1' }),
      },
      webhookEvent: {
        findUnique: vi.fn().mockResolvedValue({ id: 'event-1', status: WebhookEventStatus.PROCESSED }),
        create: vi.fn(),
      },
    } as unknown as PrismaService;
    const service = new WebhooksService(
      prisma,
      { env: { GITHUB_WEBHOOK_SECRET: secret } } as unknown as AppConfigService,
      { warn: vi.fn() } as unknown as EngLoopLogger,
    );
    await expect(
      service.receiveGitHub({
        rawBody,
        signature: signed(rawBody),
        eventType: 'repository',
        deliveryId: 'delivery-1',
        payload: { installation: { id: 42 } },
      }),
    ).resolves.toEqual({ duplicate: true, id: 'event-1', status: WebhookEventStatus.PROCESSED });
    expect((prisma.webhookEvent.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('upserts a real pull request and marks the delivery processed', async () => {
    const payload = {
      installation: { id: 42 },
      repository: { id: 99 },
      pull_request: {
        number: 7,
        title: 'Real PR',
        body: 'body',
        state: 'open',
        draft: false,
        merged: false,
        html_url: 'https://github.com/evalley/engloop/pull/7',
        head: { ref: 'agent/task' },
        base: { ref: 'main' },
        merged_at: null,
        closed_at: null,
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const upsert = vi.fn().mockResolvedValue({ id: 'pr-1' });
    const update = vi.fn().mockResolvedValue({ id: 'event-1' });
    const transactionClient = {
      webhookEvent: { update },
      repository: { findFirst: vi.fn().mockResolvedValue({ id: 'repository-1' }) },
      pullRequest: { upsert },
    };
    const prisma = {
      gitHubInstallation: { findUnique: vi.fn().mockResolvedValue({ id: 'installation-record', organizationId: 'org-1' }) },
      webhookEvent: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'event-1' }),
        update: vi.fn(),
      },
      $transaction: vi.fn((callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient)),
    } as unknown as PrismaService;
    const service = new WebhooksService(
      prisma,
      { env: { GITHUB_WEBHOOK_SECRET: secret } } as unknown as AppConfigService,
      { warn: vi.fn(), error: vi.fn() } as unknown as EngLoopLogger,
    );
    await service.receiveGitHub({ rawBody, signature: signed(rawBody), eventType: 'pull_request', deliveryId: 'delivery-2', payload });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ local: false, number: 7, status: PullRequestStatus.OPEN }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: WebhookEventStatus.PROCESSED }) }),
    );
  });

  it('records a failed delivery and allows a later retry to claim it', async () => {
    const payload = { installation: { id: 42 }, repository: { id: 99 }, ref: 'refs/heads/main', after: 'abc' };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const failed = { id: 'event-1', status: WebhookEventStatus.FAILED };
    const transactionClient = {
      webhookEvent: { update: vi.fn() },
      repository: { findFirst: vi.fn().mockRejectedValue(new Error('database unavailable')) },
    };
    const update = vi.fn().mockResolvedValue(failed);
    const prisma = {
      gitHubInstallation: { findUnique: vi.fn().mockResolvedValue({ id: 'installation-record', organizationId: 'org-1' }) },
      webhookEvent: {
        findUnique: vi.fn().mockResolvedValue(failed),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update,
      },
      $transaction: vi.fn((callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient)),
    } as unknown as PrismaService;
    const service = new WebhooksService(
      prisma,
      { env: { GITHUB_WEBHOOK_SECRET: secret } } as unknown as AppConfigService,
      { warn: vi.fn(), error: vi.fn() } as unknown as EngLoopLogger,
    );

    await expect(service.receiveGitHub({ rawBody, signature: signed(rawBody), eventType: 'push', deliveryId: 'delivery-3', payload })).rejects.toMatchObject({ status: 500 });
    expect((prisma.webhookEvent.updateMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'event-1', status: WebhookEventStatus.FAILED } }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: WebhookEventStatus.FAILED }) }),
    );
  });
});
