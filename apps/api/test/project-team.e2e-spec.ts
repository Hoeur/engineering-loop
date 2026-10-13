import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { silentLogger } from '@engloop/logger';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../src/common/decorators/auth.decorators';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response.interceptor';
import { LOGGER } from '../src/infrastructure/logger/logger.tokens';
import { ProjectTeamController } from '../src/modules/projects/project-team.controller';
import { ProjectTeamService } from '../src/modules/projects/project-team.service';
import { AppError } from '../src/common/errors/app-error';

describe('Project team HTTP contract', () => {
  let app: INestApplication;
  const read = vi.fn().mockResolvedValue({
    expectedVersion: 0,
    memberIds: [],
    coverage: { requiredRoles: [], coveredRoles: [], missingRoles: [] },
  });
  const replace = vi.fn().mockResolvedValue({ expectedVersion: 0, memberIds: [] });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProjectTeamController],
      providers: [
        { provide: ProjectTeamService, useValue: { read, replace } },
        { provide: LOGGER, useValue: silentLogger },
        { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: AuthenticatedRequest, _res: unknown, next: () => void) => {
      req.user = {
        id: 'user',
        email: 'owner@example.test',
        name: 'Owner',
        organizationId: 'trusted-org',
        role: 'OWNER',
      };
      next();
    });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('returns the envelope and forwards only the trusted organization', async () => {
    const response = await request(app.getHttpServer())
      .get('/projects/project-one/team?organizationId=foreign')
      .expect(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { expectedVersion: 0, memberIds: [] },
      meta: expect.any(Object),
    });
    expect(read).toHaveBeenLastCalledWith('trusted-org', 'project-one');
  });
  it('validates the shared schema before forwarding the trusted caller role', async () => {
    await request(app.getHttpServer())
      .put('/projects/project-one/team')
      .send({ expectedVersion: 0, memberIds: [], requiredRoles: ['PLANNER'] })
      .expect(200);
    expect(replace).toHaveBeenLastCalledWith('trusted-org', 'OWNER', 'project-one', {
      expectedVersion: 0,
      memberIds: [],
      requiredRoles: ['PLANNER'],
    });
    const count = replace.mock.calls.length;
    for (const invalid of [
      { expectedVersion: 0, memberIds: ['agent-one', 'agent-one'], requiredRoles: [] },
      { expectedVersion: 0, memberIds: [], requiredRoles: ['OWNER'] },
      { expectedVersion: 0, memberIds: [], requiredRoles: [], organizationId: 'foreign' },
      { expectedVersion: 0, memberIds: [], requiredRoles: [], permissionLevel: 'LEVEL_5_DEPLOY' },
    ]) {
      const response = await request(app.getHttpServer())
        .put('/projects/project-one/team')
        .send(invalid)
        .expect(422);
      expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    }
    expect(replace).toHaveBeenCalledTimes(count);
  });
  it('returns stable lifecycle conflict errors', async () => {
    replace.mockRejectedValueOnce(AppError.conflict('PHASE_LOCKED', 'Team edits are locked'));
    const response = await request(app.getHttpServer())
      .put('/projects/project-one/team')
      .send({ expectedVersion: 0, memberIds: [], requiredRoles: [] })
      .expect(409);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'PHASE_LOCKED', message: 'Team edits are locked' },
    });
  });
});
