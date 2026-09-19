import { AsyncLocalStorage } from 'node:async_hooks';
import type { ExecutionContext } from '@engloop/types';

/**
 * Per-request correlation store. Services read from here instead of threading a
 * context object through every signature, so every log line and audit row can
 * carry requestId/traceId without ceremony.
 */
export const requestContextStorage = new AsyncLocalStorage<ExecutionContext>();

export const getRequestContext = (): ExecutionContext =>
  requestContextStorage.getStore() ?? { traceId: 'unknown' };

export const withRequestContext = <T>(context: ExecutionContext, fn: () => T): T =>
  requestContextStorage.run(context, fn);
