import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { EngLoopLogger } from '@engloop/logger';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LOGGER } from '../../infrastructure/logger/logger.tokens';
import { getRequestContext } from '../request-context';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(@Inject(LOGGER) private readonly logger: EngLoopLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const startedAt = Date.now();
    const ctx = getRequestContext();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = http.getResponse<Response>();
          this.logger.withContext(ctx).info(
            {
              method: request.method,
              path: request.originalUrl,
              statusCode: response.statusCode,
              durationMs: Date.now() - startedAt,
            },
            'http.request.completed',
          );
        },
        error: (error: unknown) => {
          this.logger.withContext(ctx).warn(
            {
              method: request.method,
              path: request.originalUrl,
              durationMs: Date.now() - startedAt,
              error: error instanceof Error ? error.message : String(error),
            },
            'http.request.failed',
          );
        },
      }),
    );
  }
}
