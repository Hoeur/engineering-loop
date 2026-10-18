import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { NextFunction, Response } from 'express';
import { silentLogger } from '@engloop/logger';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@engloop/db';
import { OrgRole, ProjectPhaseStatus } from '@engloop/types';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProjectPromptsService } from '../src/modules/projects/project-prompts.service';
import { ProjectPromptsController } from '../src/modules/projects/project-prompts.controller';
import type { AuthenticatedRequest } from '../src/common/decorators/auth.decorators';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response.interceptor';
import { LOGGER } from '../src/infrastructure/logger/logger.tokens';

const databaseUrl = process.env.ENGLOOP_PROMPT_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))('Project prompts PostgreSQL integration', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ProjectPromptsService;
  let audit: AuditService;
  let org: string;
  let foreign: string;
  let project: string;
  let other: string;
  let task: string;
  let unphased: string;
  let app: INestApplication;
  const create = (body = '{{task.title}} / {{project.name}}') =>
    service.create(org, OrgRole.ADMIN, project, { name: 'Implement', role: 'IMPLEMENTER', body });

  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl });
    audit = new AuditService(prisma as PrismaService);
    service = new ProjectPromptsService(prisma as PrismaService, audit);
    org = (
      await prisma.organization.create({
        data: { name: 'Prompt test', slug: `prompts-${randomUUID()}` },
      })
    ).id;
    foreign = (
      await prisma.organization.create({
        data: { name: 'Foreign', slug: `foreign-prompts-${randomUUID()}` },
      })
    ).id;
    project = (
      await prisma.project.create({
        data: { organizationId: org, name: 'Project', slug: 'project', key: 'P' },
      })
    ).id;
    other = (
      await prisma.project.create({
        data: { organizationId: org, name: 'Other', slug: 'other', key: 'O' },
      })
    ).id;
    const phase = await prisma.projectPhase.create({
      data: {
        projectId: project,
        name: 'Phase',
        position: 0,
        objective: 'Phase goal',
        status: ProjectPhaseStatus.ACTIVE,
      },
    });
    task = (
      await prisma.task.create({
        data: {
          projectId: project,
          phaseId: phase.id,
          key: 'P-1',
          title: 'Literal {{role}}',
          objective: 'Task goal',
        },
      })
    ).id;
    unphased = (
      await prisma.task.create({ data: { projectId: project, key: 'P-2', title: 'Unphased' } })
    ).id;
    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectPromptsController],
      providers: [
        { provide: ProjectPromptsService, useValue: service },
        { provide: LOGGER, useValue: silentLogger },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      req.user = {
        id: 'test-user',
        email: 'test@example.test',
        name: 'Test',
        organizationId: org,
        role: OrgRole.ADMIN,
      };
      next();
    });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.organization.deleteMany({
      where: { id: { in: [org, foreign].filter(Boolean) } },
    });
    await prisma?.$disconnect();
  });

  it('exercises the HTTP create, revise, historical read, preview and output-validation flow', async () => {
    const base = `/projects/${project}/prompts`;
    const created = await request(app.getHttpServer())
      .post(base)
      .send({ name: 'Docs HTTP', role: 'DOCUMENTATION', body: 'Write {{task.title}}' })
      .expect(201);
    expect(created.body.success).toBe(true);
    const id: string = created.body.data.id;
    await request(app.getHttpServer())
      .post(`${base}/${id}/revisions`)
      .send({ expectedRevision: 1, body: 'New {{task.title}}' })
      .expect(201);
    const old = await request(app.getHttpServer()).get(`${base}/${id}/revisions/1`).expect(200);
    expect(old.body.data.body).toBe('Write {{task.title}}');
    const preview = await request(app.getHttpServer())
      .post(`${base}/${id}/revisions/2/preview`)
      .send({ taskId: task })
      .expect(201);
    expect(preview.body.data.body).toBe('New Literal {{role}}');
    await request(app.getHttpServer())
      .post(`${base}/${id}/revisions/2/validate-output`)
      .send({ output: { summary: 'Docs' } })
      .expect(201);
    const invalid = await request(app.getHttpServer())
      .post(`${base}/${id}/revisions/2/validate-output`)
      .send({ output: {} })
      .expect(422);
    expect(invalid.body).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('rejects invalid HTTP variables and revision parameters with the shared validation envelope', async () => {
    const base = `/projects/${project}/prompts`;
    const invalid = await request(app.getHttpServer())
      .post(base)
      .send({ name: 'Invalid', role: 'IMPLEMENTER', body: '{{provider.credential}}' })
      .expect(422);
    expect(invalid.body).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    for (const revision of ['0', '2147483648', 'not-a-number']) {
      const response = await request(app.getHttpServer())
        .get(`${base}/missing/revisions/${revision}`)
        .expect(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('preserves old revisions and emits atomic audit records', async () => {
    const template = await create();
    expect(template.currentRevision).toBe(1);
    expect(template.revisions).toHaveLength(1);
    const revision = await service.revise(org, OrgRole.OWNER, project, template.id, {
      expectedRevision: 1,
      body: 'Next {{task.objective}}',
    });
    expect(revision.revision).toBe(2);
    expect((await service.read(org, project, template.id, 1)).body).toBe(
      '{{task.title}} / {{project.name}}',
    );
    expect((await service.read(org, project, template.id, 2)).body).toBe('Next {{task.objective}}');
    expect(
      (await service.list(org, project)).find((row) => row.id === template.id)?.currentRevision,
    ).toBe(2);
    expect(await prisma.auditLog.count({ where: { entityId: template.id } })).toBe(2);
    await expect(
      service.revise(org, OrgRole.ADMIN, project, template.id, {
        expectedRevision: 1,
        body: 'Stale',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects foreign tenants, projects, tasks, and unauthorized writes', async () => {
    const template = await create();
    await expect(service.list(foreign, project)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.read(foreign, project, template.id, 1)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.read(org, other, template.id, 1)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.create(foreign, OrgRole.ADMIN, project, {
        name: 'Foreign',
        role: 'IMPLEMENTER',
        body: 'Text',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.revise(foreign, OrgRole.ADMIN, project, template.id, {
        expectedRevision: 1,
        body: 'Foreign',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const role of [OrgRole.VIEWER, OrgRole.MEMBER, OrgRole.MAINTAINER]) {
      await expect(
        service.create(org, role, project, { name: 'No', role: 'IMPLEMENTER', body: 'Text' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        service.revise(org, role, project, template.id, { expectedRevision: 1, body: 'No' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    const otherTask = await prisma.task.create({
      data: { projectId: other, key: 'O-1', title: 'Other' },
    });
    await expect(service.preview(org, project, template.id, 1, otherTask.id)).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    await expect(service.validate(foreign, project, template.id, 1, {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('resolves explicit context without recursive expansion and fails missing phase context', async () => {
    const template = await create('{{task.title}} / {{phase.objective}} / {{role}}');
    expect((await service.preview(org, project, template.id, 1, task)).body).toBe(
      'Literal {{role}} / Phase goal / IMPLEMENTER',
    );
    await expect(service.preview(org, project, template.id, 1, unphased)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const noPhase = await create('{{task.title}}');
    expect((await service.preview(org, project, noPhase.id, 1, unphased)).body).toBe('Unphased');
    await expect(create('{{provider.credential}}')).rejects.toThrow();
    await expect(service.validate(org, project, template.id, 1, {})).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const docs = await service.create(org, OrgRole.ADMIN, project, {
      name: 'Docs',
      role: 'DOCUMENTATION',
      body: 'Document {{task.title}}',
    });
    expect(await service.validate(org, project, docs.id, 1, { summary: 'Done' })).toMatchObject({
      valid: true,
    });
  });

  it('serializes racing revisions so only one expected revision wins', async () => {
    const template = await create();
    const results = await Promise.allSettled(
      ['First', 'Second'].map((body) =>
        service.revise(org, OrgRole.ADMIN, project, template.id, { expectedRevision: 1, body }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') expect(failure.reason).toMatchObject({ code: 'CONFLICT' });
    expect(await prisma.promptRevision.count({ where: { templateId: template.id } })).toBe(2);
  });

  it('rolls back creation and revision when audit persistence fails', async () => {
    const template = await create();
    const before = await prisma.promptTemplate.count({ where: { projectId: project } });
    const spy = vi.spyOn(audit, 'recordInTransaction').mockRejectedValue(new Error('Audit failed'));
    try {
      await expect(create()).rejects.toThrow('Audit failed');
      await expect(
        service.revise(org, OrgRole.ADMIN, project, template.id, {
          expectedRevision: 1,
          body: 'Rollback',
        }),
      ).rejects.toThrow('Audit failed');
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.promptTemplate.count({ where: { projectId: project } })).toBe(before);
    expect(
      (await prisma.promptTemplate.findUniqueOrThrow({ where: { id: template.id } }))
        .currentRevision,
    ).toBe(1);
    expect(await prisma.promptRevision.count({ where: { templateId: template.id } })).toBe(1);
  });

  it('refuses in-place revision edits in the database, while template deletes still cascade', async () => {
    const template = await create();
    await expect(
      prisma.promptRevision.updateMany({
        where: { templateId: template.id, revision: 1 },
        data: { body: 'Tampered {{task.title}}' },
      }),
    ).rejects.toThrow(/immutable/u);
    expect((await service.read(org, project, template.id, 1)).body).toBe(
      '{{task.title}} / {{project.name}}',
    );
    await prisma.promptTemplate.delete({ where: { id: template.id } });
    expect(await prisma.promptRevision.count({ where: { templateId: template.id } })).toBe(0);
  });
});
