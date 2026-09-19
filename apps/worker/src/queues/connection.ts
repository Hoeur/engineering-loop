import IORedis, { type Redis } from 'ioredis';
import type { Env } from '@engloop/config';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on the blocking connection;
 * ioredis's default of 20 makes workers drop jobs during a Redis restart.
 */
export const createRedisConnection = (env: Env): Redis =>
  new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
