import { Controller, Get, type INestApplication, Module, Post, Body } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TaskStatus } from '@engloop/types';
import { transitionTaskSchema } from '@engloop/schemas';
import { taskStateMachine } from '@engloop/workflow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response.interceptor';
import { RequestContextMiddleware } from '../src/common/middleware/request-context.middleware';
import { zodPipe } from '../src/common/pipes/zod-validation.pipe';
import { AppError } from '../src/common/errors/app-error';
import { LOGGER } from '../src/infrastructure/logger/logger.tokens';
import { silentLogger } from '@engloop/logger';

/**
 * Contract test for spec section 48.
 *
 * Exercises the real interceptor, filter and Zod pipe against a throwaway
 * controller, so the envelope is verified without a database or Redis.
 */
@Controller('probe')
class ProbeController {
  @Get('ok')
  ok() {
    return { hello: 'world' };
  }

  @Get('list')
  list() {
    return { items: [1, 2, 3], meta: { pagination: { page: 1, pageSize: 25, total: 3 } } };
  }

  @Get('missing')
  missing() {
    throw AppError.notFound('Task', 'ENG-999');
  }

  @Get('boom')
  boom(): never {
    throw new Error('internal detail that must not leak');
  }

  @Post('transition')
  transition(@Body(zodPipe(transitionTaskSchema)) body: { to: TaskStatus }) {
    taskStateMachine.assert(TaskStatus.TESTING, body.to);
    return { to: body.to };
  }
}

@Module({
  controllers: [ProbeController],
  providers: [
    { provide: LOGGER, useValue: silentLogger },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
class ProbeModule {}

describe('API response envelope', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(new RequestContextMiddleware().use.bind(new RequestContextMiddleware()));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps a successful response in { success, data, meta }', async () => {
    const response = await request(app.getHttpServer()).get('/probe/ok').expect(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({ hello: 'world' });
    expect(response.body.meta.timestamp).toBeDefined();
  });

  it('returns a request id header for correlation', async () => {
    const response = await request(app.getHttpServer()).get('/probe/ok').expect(200);
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.headers['x-trace-id']).toBeDefined();
  });

  it('echoes a caller-supplied request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/probe/ok')
      .set('x-request-id', 'caller-supplied-id')
      .expect(200);
    expect(response.headers['x-request-id']).toBe('caller-supplied-id');
  });

  it('lifts pagination metadata into meta', async () => {
    const response = await request(app.getHttpServer()).get('/probe/list').expect(200);
    expect(response.body.data.items).toHaveLength(3);
    expect(response.body.meta.pagination.total).toBe(3);
  });

  it('returns a typed NOT_FOUND envelope', async () => {
    const response = await request(app.getHttpServer()).get('/probe/missing').expect(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(response.body.error.details).toEqual({ entity: 'Task', id: 'ENG-999' });
  });

  it('never leaks an internal error message', async () => {
    const response = await request(app.getHttpServer()).get('/probe/boom').expect(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('internal detail');
  });

  it('returns VALIDATION_FAILED with field-level issues', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/transition')
      .send({ to: 'NOT_A_STATUS' })
      .expect(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.issues[0].path).toBe('to');
  });

  it('returns 409 TASK_INVALID_TRANSITION for an illegal state move', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/transition')
      .send({ to: TaskStatus.COMPLETED })
      .expect(409);
    expect(response.body.error.code).toBe('TASK_INVALID_TRANSITION');
    expect(response.body.error.message).toContain('TESTING');
    expect(response.body.error.details.allowed).toBeInstanceOf(Array);
  });

  it('accepts a legal transition', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/transition')
      .send({ to: TaskStatus.REVIEWING })
      .expect(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.to).toBe(TaskStatus.REVIEWING);
  });
});
