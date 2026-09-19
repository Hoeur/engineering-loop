import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiErrorCode } from '@engloop/types';

/**
 * Every deliberate failure in the API is an AppError. The global filter turns it
 * into the standard `{ success: false, error: { code, message, details } }`
 * envelope (spec section 48) — no bare strings, no leaked stack traces.
 */
export class AppError extends HttpException {
  constructor(
    readonly code: ApiErrorCode | string,
    message: string,
    status: HttpStatus,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
    this.name = 'AppError';
  }

  static badRequest(code: string, message: string, details?: Record<string, unknown>): AppError {
    return new AppError(code, message, HttpStatus.BAD_REQUEST, details);
  }

  static validation(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(
      ApiErrorCode.VALIDATION_FAILED,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
      details,
    );
  }

  static notFound(entity: string, id?: string): AppError {
    return new AppError(
      ApiErrorCode.NOT_FOUND,
      id ? `${entity} "${id}" was not found` : `${entity} was not found`,
      HttpStatus.NOT_FOUND,
      id ? { entity, id } : { entity },
    );
  }

  static conflict(code: string, message: string, details?: Record<string, unknown>): AppError {
    return new AppError(code, message, HttpStatus.CONFLICT, details);
  }

  static forbidden(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(ApiErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN, details);
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(ApiErrorCode.UNAUTHORIZED, message, HttpStatus.UNAUTHORIZED);
  }

  static internal(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(
      ApiErrorCode.INTERNAL_ERROR,
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
      details,
    );
  }

  static dependencyUnavailable(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(
      ApiErrorCode.DEPENDENCY_UNAVAILABLE,
      message,
      HttpStatus.SERVICE_UNAVAILABLE,
      details,
    );
  }
}
