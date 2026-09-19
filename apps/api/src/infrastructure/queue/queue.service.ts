import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, type QueueName } from '@engloop/config';
import type { EngLoopLogger } from '@engloop/logger';
import { AppConfigService } from '../config/config.service';
import { LOGGER } from '../logger/logger.tokens';

/**
 * Thin BullMQ producer. The API only ever *enqueues*; all execution happens in
 * `apps/worker`, which is the only process allowed to touch a git worktree or
 * spawn a command.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    private readonly config: AppConfigService,
    @Inject(LOGGER) private readonly logger: EngLoopLogger,
  ) {
    this.connection = new IORedis({
      ...config.redisConnection,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    this.connection.on('error', (error: Error) => {
      this.logger.warn({ error: error.message }, 'redis.connection.error');
    });
  }

  queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.connection,
        prefix: this.config.env.QUEUE_PREFIX,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  /**
   * `jobId` doubles as the idempotency key: BullMQ refuses to add a second job
   * with the same id, so an at-least-once producer cannot fork duplicate work.
   */
  async enqueue<TPayload extends object>(
    name: QueueName,
    jobName: string,
    payload: TPayload,
    options: JobsOptions & { jobId?: string } = {},
  ): Promise<string | undefined> {
    const job = await this.queue(name).add(jobName, payload, options);
    this.logger.debug({ queue: name, jobName, jobId: job.id }, 'queue.enqueued');
    return job.id;
  }

  async removeRepeatable(name: QueueName, key: string): Promise<void> {
    await this.queue(name).removeJobScheduler(key);
  }

  async upsertRepeatable(
    name: QueueName,
    key: string,
    cron: string,
    timezone: string,
    jobName: string,
    payload: object,
  ): Promise<void> {
    await this.queue(name).upsertJobScheduler(
      key,
      { pattern: cron, tz: timezone },
      { name: jobName, data: payload },
    );
  }

  async health(): Promise<{ healthy: boolean; detail: string }> {
    try {
      const pong = await this.connection.ping();
      return { healthy: pong === 'PONG', detail: pong };
    } catch (error) {
      return { healthy: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async counts(): Promise<Record<string, Record<string, number>>> {
    const entries = await Promise.all(
      Object.values(QUEUE_NAMES).map(async (name) => {
        try {
          const counts = await this.queue(name).getJobCounts();
          return [name, counts] as const;
        } catch {
          return [name, {}] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.connection.disconnect();
  }
}
