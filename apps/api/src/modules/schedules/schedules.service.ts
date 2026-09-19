import { Injectable } from '@nestjs/common';
import { AuditAction, type ScheduleType } from '@engloop/types';
import { JOB_NAMES, QUEUE_NAMES } from '@engloop/config';
import type { CreateScheduleDto } from '@engloop/schemas';
import type { Prisma } from '@engloop/db';
import { parseExpression } from 'cron-parser';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

/** Scheduler infrastructure (spec section 18) built on BullMQ repeatable jobs. */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
  ) {}

  private nextRun(cron: string, timezone: string): Date | null {
    try {
      return parseExpression(cron, { tz: timezone }).next().toDate();
    } catch {
      return null;
    }
  }

  private validateCron(cron: string, timezone: string): void {
    if (!this.nextRun(cron, timezone)) {
      throw AppError.validation('Invalid cron expression', { cronExpression: cron, timezone });
    }
  }

  async list(projectId?: string) {
    const items = await this.prisma.schedule.findMany({
      where: projectId ? { projectId } : {},
      orderBy: { name: 'asc' },
      include: {
        project: { select: { id: true, name: true, key: true } },
        repository: { select: { id: true, name: true } },
      },
    });
    return { items, meta: {} };
  }

  async findOne(id: string) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { id },
      include: { project: true, repository: true },
    });
    if (!schedule) throw AppError.notFound('Schedule', id);
    return schedule;
  }

  async create(dto: CreateScheduleDto) {
    this.validateCron(dto.cronExpression, dto.timezone);

    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      select: { organizationId: true },
    });
    if (!project) throw AppError.notFound('Project', dto.projectId);

    const schedule = await this.prisma.schedule.create({
      data: {
        projectId: dto.projectId,
        repositoryId: dto.repositoryId ?? null,
        name: dto.name,
        type: dto.type,
        cronExpression: dto.cronExpression,
        timezone: dto.timezone,
        enabled: dto.enabled,
        configuration: dto.configuration as Prisma.InputJsonValue,
        nextRunAt: this.nextRun(dto.cronExpression, dto.timezone),
      },
    });

    if (schedule.enabled) await this.register(schedule.id);

    await this.audit.recordSafe({
      organizationId: project.organizationId,
      projectId: dto.projectId,
      action: AuditAction.SCHEDULE_CHANGED,
      entityType: 'schedule',
      entityId: schedule.id,
      summary: `Created schedule ${schedule.name} (${schedule.cronExpression})`,
    });

    return schedule;
  }

  async update(id: string, dto: Partial<CreateScheduleDto>) {
    const existing = await this.prisma.schedule.findUnique({
      where: { id },
      include: { project: { select: { organizationId: true } } },
    });
    if (!existing) throw AppError.notFound('Schedule', id);

    const cron = dto.cronExpression ?? existing.cronExpression;
    const timezone = dto.timezone ?? existing.timezone;
    if (dto.cronExpression || dto.timezone) this.validateCron(cron, timezone);

    const schedule = await this.prisma.schedule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type as ScheduleType } : {}),
        ...(dto.cronExpression !== undefined ? { cronExpression: dto.cronExpression } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.configuration !== undefined
          ? { configuration: dto.configuration as Prisma.InputJsonValue }
          : {}),
        nextRunAt: this.nextRun(cron, timezone),
      },
    });

    await (schedule.enabled ? this.register(schedule.id) : this.unregister(schedule.id));

    await this.audit.recordSafe({
      organizationId: existing.project.organizationId,
      projectId: existing.projectId,
      action: AuditAction.SCHEDULE_CHANGED,
      entityType: 'schedule',
      entityId: id,
      summary: `Updated schedule ${schedule.name}`,
      metadata: { changes: dto as Record<string, unknown> },
    });

    return schedule;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.unregister(id);
    await this.prisma.schedule.delete({ where: { id } });
    return { deleted: true, id };
  }

  /** Fires a schedule immediately, outside its cron cadence. */
  async runNow(id: string) {
    const schedule = await this.findOne(id);
    await this.queues.enqueue(
      QUEUE_NAMES.SCHEDULER,
      JOB_NAMES.FIRE_SCHEDULE,
      { scheduleId: id, manual: true },
      { jobId: `schedule-manual:${id}:${String(Date.now())}` },
    );
    return { scheduleId: schedule.id, queued: true };
  }

  private async register(scheduleId: string): Promise<void> {
    const schedule = await this.prisma.schedule.findUniqueOrThrow({ where: { id: scheduleId } });
    await this.queues.upsertRepeatable(
      QUEUE_NAMES.SCHEDULER,
      `schedule:${scheduleId}`,
      schedule.cronExpression,
      schedule.timezone,
      JOB_NAMES.FIRE_SCHEDULE,
      { scheduleId },
    );
  }

  private async unregister(scheduleId: string): Promise<void> {
    await this.queues
      .removeRepeatable(QUEUE_NAMES.SCHEDULER, `schedule:${scheduleId}`)
      .catch(() => undefined);
  }
}
