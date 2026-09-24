import { Queue, Worker, type Processor } from 'bullmq';
import { QUEUE_NAMES } from '@engloop/config';
import { createWorkerContext } from './context';
import { createRedisConnection } from './queues/connection';
import { createWorkflowProcessor } from './processors/workflow.processor';
import { createTestsProcessor } from './processors/tests.processor';
import { createReviewProcessor } from './processors/review.processor';
import { createSchedulerProcessor } from './processors/scheduler.processor';
import { createAgentProcessor } from './processors/agent.processor';
import { persistProviderHealth, startHealthServer } from './health';
import { registerShutdownSignals, stopWorkerExecution } from './shutdown';

async function bootstrap(): Promise<void> {
  const worker = createWorkerContext();
  const { env, logger } = worker;

  await worker.worktrees.ensureLayout();

  const connection = createRedisConnection(env);
  const workflowQueue = new Queue(QUEUE_NAMES.WORKFLOW, {
    connection,
    prefix: env.QUEUE_PREFIX,
  });

  const definitions: { name: string; processor: Processor; concurrency: number }[] = [
    {
      name: QUEUE_NAMES.WORKFLOW,
      processor: createWorkflowProcessor(worker, workflowQueue) as Processor,
      // The workflow queue is intentionally sequential per process: steps mutate
      // shared task state, and BullMQ's per-job locking is not a substitute for
      // that ordering guarantee.
      concurrency: 1,
    },
    {
      name: QUEUE_NAMES.AGENT,
      processor: createAgentProcessor(worker) as Processor,
      concurrency: env.WORKER_CONCURRENCY,
    },
    {
      name: QUEUE_NAMES.TESTS,
      processor: createTestsProcessor(worker) as Processor,
      concurrency: Math.max(1, Math.floor(env.WORKER_CONCURRENCY / 2)),
    },
    {
      name: QUEUE_NAMES.REVIEW,
      processor: createReviewProcessor(worker) as Processor,
      concurrency: env.WORKER_CONCURRENCY,
    },
    {
      name: QUEUE_NAMES.SCHEDULER,
      processor: createSchedulerProcessor(worker) as Processor,
      concurrency: 1,
    },
  ];

  const workers = definitions.map((definition) => {
    const instance = new Worker(definition.name, definition.processor, {
      connection: createRedisConnection(env),
      prefix: env.QUEUE_PREFIX,
      concurrency: definition.concurrency,
    });

    instance.on('failed', (job, error) => {
      logger.error(
        { queue: definition.name, jobId: job?.id, error: error.message },
        'queue.job.failed',
      );
    });
    instance.on('error', (error) => {
      logger.error({ queue: definition.name, error: error.message }, 'queue.error');
    });

    return instance;
  });

  const health = startHealthServer(worker, env.WORKER_HEALTH_PORT);
  registerShutdownSignals(process, async (signal): Promise<void> => {
    logger.info({ signal }, 'worker.shutting_down');
    await stopWorkerExecution({
      workers,
      executionRuntime: worker.executionRuntime,
      workflowQueue,
    });
    health.close();
    connection.disconnect();
    await worker.prisma.$disconnect();
    process.exit(0);
  });

  const providerHealth = await worker.registry.healthCheckAll();
  try {
    await persistProviderHealth(worker, providerHealth);
  } catch (error) {
    // Health persistence must not take down command execution during a brief
    // database startup race; the health endpoint retries it on every probe.
    logger.warn({ error: String(error) }, 'provider.health.persist_failed');
  }
  logger.info(
    {
      queues: definitions.map((definition) => definition.name),
      concurrency: env.WORKER_CONCURRENCY,
      healthPort: env.WORKER_HEALTH_PORT,
      defaultProvider: env.AGENT_DEFAULT_PROVIDER,
      providers: Object.fromEntries(
        Object.entries(providerHealth).map(([key, value]) => [key, value.healthy]),
      ),
      // Credentials are resolved per run from each organization's stored key,
      // so there is no process-wide auth source to report here.
      credentialSource: 'database-per-organization',
    },
    'worker.started',
  );
}

void bootstrap().catch((error: unknown) => {
  console.error('Failed to start EngLoop worker', error);
  process.exit(1);
});
