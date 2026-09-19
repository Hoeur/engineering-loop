import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiResponse } from '@nestjs/swagger';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const toSchema = (schema: ZodTypeAny): Record<string, unknown> =>
  zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;

/** Documents a Zod-validated request body in Swagger without duplicating the DTO. */
export const ApiZodBody = (schema: ZodTypeAny, description?: string): MethodDecorator =>
  ApiBody({ description, schema: toSchema(schema) });

const envelope = (dataSchema: Record<string, unknown>): Record<string, unknown> => ({
  type: 'object',
  required: ['success', 'data', 'meta'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: dataSchema,
    meta: { type: 'object', additionalProperties: true },
  },
});

const errorEnvelope = {
  type: 'object',
  required: ['success', 'error', 'meta'],
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', example: 'TASK_INVALID_TRANSITION' },
        message: { type: 'string', example: 'Task cannot move from TESTING to COMPLETED.' },
        details: { type: 'object', additionalProperties: true },
      },
    },
    meta: { type: 'object', additionalProperties: true },
  },
};

/** Documents the standard success + failure envelopes on a route. */
export const ApiEnvelopeResponse = (
  status: number,
  dataSchema?: ZodTypeAny | Record<string, unknown>,
  description?: string,
): MethodDecorator => {
  const data =
    dataSchema === undefined
      ? { type: 'object', additionalProperties: true }
      : 'safeParse' in (dataSchema as object)
        ? toSchema(dataSchema as ZodTypeAny)
        : (dataSchema as Record<string, unknown>);

  return applyDecorators(
    ApiExtraModels(),
    ApiResponse({ status, description, schema: envelope(data) }),
    ApiResponse({ status: 422, description: 'Validation failed', schema: errorEnvelope }),
    ApiResponse({ status: 404, description: 'Not found', schema: errorEnvelope }),
    ApiResponse({
      status: 409,
      description: 'Conflict / invalid transition',
      schema: errorEnvelope,
    }),
  );
};
