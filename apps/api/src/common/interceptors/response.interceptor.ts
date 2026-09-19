import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { ApiSuccess } from '@engloop/types';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { getRequestContext } from '../request-context';

const RAW_RESPONSE = Symbol.for('engloop.raw-response');

/** Marks a handler's return value as already-enveloped (or intentionally raw). */
export const rawResponse = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.defineProperty(value, RAW_RESPONSE, { value: true, enumerable: false });
  }
  return value;
};

/**
 * Wraps every successful handler result in the canonical envelope. Controllers
 * return plain data; the shape is applied in exactly one place.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<ApiSuccess<unknown>> {
    return next.handle().pipe(
      map((data: unknown) => {
        const ctx = getRequestContext();
        if (data && typeof data === 'object' && RAW_RESPONSE in (data as object)) {
          return data as ApiSuccess<unknown>;
        }
        if (
          data &&
          typeof data === 'object' &&
          'success' in (data as Record<string, unknown>) &&
          'data' in (data as Record<string, unknown>)
        ) {
          return data as ApiSuccess<unknown>;
        }

        const payload = data as { items?: unknown; meta?: Record<string, unknown> } | null;
        const meta =
          payload && typeof payload === 'object' && payload.meta
            ? { ...payload.meta }
            : ({} as Record<string, unknown>);

        return {
          success: true,
          data: data ?? null,
          meta: {
            requestId: ctx.requestId,
            timestamp: new Date().toISOString(),
            ...meta,
          },
        } satisfies ApiSuccess<unknown>;
      }),
    );
  }
}
