import { Injectable } from '@nestjs/common';
import {
  DomainEventName,
  NotificationChannel,
  Severity,
  type NotificationType,
} from '@engloop/types';
import type { Prisma } from '@engloop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EventBus } from '../../infrastructure/events/event-bus';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/pagination';
import type { NotificationPayload, NotificationProvider } from './notification-provider';

/** In-app channel: the only delivery mechanism wired in the MVP. */
class InAppNotificationProvider implements NotificationProvider {
  readonly channel = NotificationChannel.IN_APP;
  readonly enabled = true;
  async deliver(): Promise<void> {
    // The database row created by NotificationsService *is* the delivery.
  }
}

@Injectable()
export class NotificationsService {
  private readonly providers: NotificationProvider[] = [new InAppNotificationProvider()];

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {
    this.subscribe();
  }

  /** Domain events → user-visible notifications. */
  private subscribe(): void {
    this.events.on(DomainEventName.TASK_NEEDS_HUMAN_REVIEW, async (event) => {
      const task = await this.prisma.task.findUnique({
        where: { id: event.payload.taskId },
        select: { key: true, title: true, project: { select: { organizationId: true } } },
      });
      if (!task) return;
      await this.create({
        organizationId: task.project.organizationId,
        type: 'HUMAN_APPROVAL_REQUIRED',
        title: `${task.key} needs human review`,
        body: `${task.title} exhausted its automated review cycles.`,
        severity: Severity.HIGH,
        payload: { taskId: event.payload.taskId, taskKey: task.key },
      });
    });

    this.events.on(DomainEventName.TASK_TESTING_FAILED, async (event) => {
      const task = await this.prisma.task.findUnique({
        where: { id: event.payload.taskId },
        select: { key: true, title: true, project: { select: { organizationId: true } } },
      });
      if (!task) return;
      await this.create({
        organizationId: task.project.organizationId,
        type: 'TEST_FAILED',
        title: `${task.key}: checks failed`,
        body: `Failing checks: ${event.payload.failedChecks.join(', ') || 'unknown'}`,
        severity: Severity.HIGH,
        payload: { taskId: event.payload.taskId, testRunId: event.payload.testRunId },
      });
    });

    this.events.on(DomainEventName.COST_LIMIT_REACHED, async (event) => {
      await this.create({
        organizationId: event.context.organizationId ?? '',
        type: 'COST_LIMIT_REACHED',
        title: 'AI spend limit reached',
        body: `${event.payload.scope} ${event.payload.scopeId} spent $${event.payload.spentUsd.toFixed(2)} of $${event.payload.limitUsd.toFixed(2)}.`,
        severity: Severity.CRITICAL,
        payload: { ...event.payload },
      });
    });
  }

  async create(payload: NotificationPayload) {
    if (!payload.organizationId) return null;

    const notification = await this.prisma.notification.create({
      data: {
        organizationId: payload.organizationId,
        userId: payload.userId ?? null,
        type: payload.type,
        channel: NotificationChannel.IN_APP,
        title: payload.title,
        body: payload.body,
        severity: payload.severity,
        payload: payload.payload as Prisma.InputJsonValue,
        deliveredAt: new Date(),
      },
    });

    await Promise.all(
      this.providers
        .filter((provider) => provider.enabled)
        .map((provider) => provider.deliver(payload).catch(() => undefined)),
    );

    return notification;
  }

  async list(organizationId: string, page: number, pageSize: number, unreadOnly: boolean) {
    const where: Prisma.NotificationWhereInput = {
      organizationId,
      ...(unreadOnly ? { readAt: null } : {}),
    };
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        ...skipTake(page, pageSize),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { organizationId, readAt: null } }),
    ]);
    const result = paginate(items, total, page, pageSize);
    return { ...result, meta: { ...result.meta, unread } };
  }

  async markRead(id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw AppError.notFound('Notification', id);
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllRead(organizationId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { organizationId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  /** Channels the platform knows about, and whether they are wired yet. */
  channels(): { channel: NotificationChannel; enabled: boolean }[] {
    const configured = new Map(this.providers.map((p) => [p.channel, p.enabled]));
    return Object.values(NotificationChannel).map((channel) => ({
      channel,
      enabled: configured.get(channel) ?? false,
    }));
  }

  typesCatalogue(): NotificationType[] {
    return [
      'TASK_FAILED',
      'TEST_FAILED',
      'REVIEW_REQUIRED',
      'HUMAN_APPROVAL_REQUIRED',
      'AGENT_FAILED',
      'PR_READY',
      'COST_LIMIT_REACHED',
      'WORKFLOW_COMPLETED',
    ];
  }
}
