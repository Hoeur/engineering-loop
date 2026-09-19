import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { parseSafely } from '@engloop/schemas';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * Bridges the shared Zod schemas into Nest's pipe system, so the browser, the API
 * and the workers all validate against one definition (spec section 10).
 */
@Injectable()
export class ZodValidationPipe<TSchema extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata): z.infer<TSchema> {
    const result = parseSafely(this.schema, value, metadata.data ?? metadata.type);
    if (!result.ok) {
      throw AppError.validation('Request payload failed validation', {
        issues: result.issues,
        target: metadata.type,
      });
    }
    return result.data;
  }
}

export const zodPipe = <TSchema extends ZodTypeAny>(schema: TSchema): ZodValidationPipe<TSchema> =>
  new ZodValidationPipe(schema);
