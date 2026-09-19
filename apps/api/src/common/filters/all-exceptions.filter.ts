import {
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ApiErrorCode, type ApiFailure } from '@engloop/types';
import { SchemaValidationError } from '@engloop/schemas';
import { InvalidTransitionError } from '@engloop/workflow';
import { isPrismaError, RECORD_NOT_FOUND, UNIQUE_VIOLATION } from '@engloop/db';
import type { EngLoopLogger } from '@engloop/logger';
import type { Response } from 'express';
import { LOGGER } from '../../infrastructure/logger/logger.tokens';
import { getRequestContext } from '../request-context';

interface NormalizedError {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  logAsError: boolean;
}

/** Single place where any thrown value becomes the canonical failure envelope. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: EngLoopLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const ctx = getRequestContext();
    const normalized = this.normalize(exception);

    const body: ApiFailure = {
      success: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details ? { details: normalized.details } : {}),
      },
      meta: { requestId: ctx.requestId, timestamp: new Date().toISOString() },
    };

    const log = this.logger.withContext(ctx);
    const payload = {
      status: normalized.status,
      code: normalized.code,
      message: normalized.message,
    };
    if (normalized.logAsError) {
      log.error(
        { ...payload, stack: exception instanceof Error ? exception.stack : undefined },
        'http.exception',
      );
    } else {
      log.debug(payload, 'http.exception');
    }

    response.status(normalized.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof InvalidTransitionError) {
      return {
        status: HttpStatus.CONFLICT,
        code: ApiErrorCode.TASK_INVALID_TRANSITION,
        message: exception.message,
        details: { from: exception.from, to: exception.to, allowed: exception.allowed },
        logAsError: false,
      };
    }

    if (exception instanceof SchemaValidationError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: ApiErrorCode.VALIDATION_FAILED,
        message: 'Payload failed validation',
        details: { issues: exception.issues },
        logAsError: false,
      };
    }

    if (isPrismaError(exception, UNIQUE_VIOLATION)) {
      const target = (exception.meta as { target?: string[] } | undefined)?.target;
      return {
        status: HttpStatus.CONFLICT,
        code: ApiErrorCode.CONFLICT,
        message: 'A record with these unique values already exists',
        details: target ? { fields: target } : undefined,
        logAsError: false,
      };
    }

    if (isPrismaError(exception, RECORD_NOT_FOUND)) {
      return {
        status: HttpStatus.NOT_FOUND,
        code: ApiErrorCode.NOT_FOUND,
        message: 'The requested record does not exist',
        logAsError: false,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'object' && body !== null && 'code' in body) {
        const typed = body as { code: string; message: string; details?: Record<string, unknown> };
        return {
          status,
          code: typed.code,
          message: typed.message,
          details: typed.details,
          logAsError: status >= 500,
        };
      }

      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);

      return {
        status,
        code: this.codeForStatus(status),
        message: Array.isArray(message) ? message.join('; ') : message,
        logAsError: status >= 500,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ApiErrorCode.INTERNAL_ERROR,
      // Never leak internal messages to clients.
      message: 'An unexpected error occurred',
      logAsError: true,
    };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ApiErrorCode.VALIDATION_FAILED;
      case HttpStatus.UNAUTHORIZED:
        return ApiErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ApiErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ApiErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ApiErrorCode.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ApiErrorCode.RATE_LIMITED;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ApiErrorCode.DEPENDENCY_UNAVAILABLE;
      default:
        return ApiErrorCode.INTERNAL_ERROR;
    }
  }
}
