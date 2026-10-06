import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@engloop/db';
import { AgentRole, OrgRole } from '@engloop/types';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProjectContractService } from '../src/modules/projects/project-contract.service';
import { ProjectPhasesService } from '../src/modules/projects/project-phases.service';

const databaseUrl = process.env.ENGLOOP_PHASE_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))('Draft project planning PostgreSQL integration', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let db: PrismaService;
  let phases: ProjectPhasesService;
  let contracts: ProjectContractService;
  let org: string;
  let foreignOrg: string;
  let project: string;
  let otherProject: string;
  let a: string;
  let b: string;
  let c: string;
  let foreignPhase: string;
  const blank = { objective: null, requirements: [], nonGoals: [], acceptanceCriteria: [] };
  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl });
    db = prisma as PrismaService;
    phases = new ProjectPhasesService(db, new AuditService(db));
    contracts = new ProjectContractService(db, new AuditService(db));
    const suffix = randomUUID();
    org = (
      await prisma.organization.create({
        data: { name: 'Planning proof', slug: `planning-${suffix}` },
      })
    ).id;
    foreignOrg = (
      await prisma.organization.create({
        data: { name: 'Foreign planning proof', slug: `foreign-planning-${suffix}` },
      })
    ).id;
    project = (
      await prisma.project.create({
        data: { organizationId: org, name: 'Planning', slug: 'planning', key: 'PLAN' },
      })
    ).id;
    otherProject = (
      await prisma.project.create({
        data: { organizationId: org, name: 'Other planning', slug: 'other-planning', key: 'OTHER' },
      })
    ).id;
    a = (await phases.create(org, OrgRole.OWNER, project, { name: 'A' })).id;
    b = (await phases.create(org, OrgRole.OWNER, project, { name: 'B' })).id;
    c = (await phases.create(org, OrgRole.OWNER, project, { name: 'C' })).id;
    foreignPhase = (await phases.create(org, OrgRole.OWNER, otherProject, { name: 'Other phase' }))
      .id;
  }, 60_000);
  afterAll(async () => {
    if (org) await prisma.organization.delete({ where: { id: org } });
    if (foreignOrg) await prisma.organization.delete({ where: { id: foreignOrg } });
    await prisma?.$disconnect();
  });

  it('reads defaults, replaces contracts, clears fields and records actual changes only', async () => {
    expect(await contracts.read(org, project)).toEqual(blank);
    const contract = {
      objective: 'Bounded delivery',
      requirements: ['Preserve existing flow'],
      nonGoals: ['Live scheduling'],
      acceptanceCriteria: ['Recorded evidence'],
    };
    expect(await contracts.replace(org, OrgRole.ADMIN, project, contract)).toEqual(contract);
    const count = await prisma.auditLog.count({
      where: { projectId: project, entityType: 'projectContract' },
    });
    const timestamp = (await prisma.project.findUniqueOrThrow({ where: { id: project } }))
      .updatedAt;
    await contracts.replace(org, OrgRole.ADMIN, project, contract);
    expect(
      await prisma.auditLog.count({ where: { projectId: project, entityType: 'projectContract' } }),
    ).toBe(count);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project } })).updatedAt).toEqual(
      timestamp,
    );
    expect(await contracts.replace(org, OrgRole.OWNER, project, blank)).toEqual(blank);
    await expect(contracts.read(foreignOrg, project)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      contracts.replace(foreignOrg, OrgRole.OWNER, project, contract),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('retains omitted planning fields, explicitly clears arrays/objectives, and exposes dependency IDs', async () => {
    const metadata = {
      objective: 'One bounded phase',
      deliverables: ['Reviewed increment'],
      acceptanceCriteria: ['All checks pass'],
      requiredRoles: [AgentRole.PLANNER, AgentRole.CODE_REVIEWER],
      dependencyIds: [a],
    };
    const updated = await phases.update(org, OrgRole.ADMIN, project, b, metadata);
    expect(updated).toMatchObject(metadata);
    const renamed = await phases.update(org, OrgRole.ADMIN, project, b, { name: 'Renamed B' });
    expect(renamed).toMatchObject(metadata);
    expect((await phases.list(org, project)).items.find((phase) => phase.id === b)).toMatchObject(
      metadata,
    );
    const before = await prisma.projectPhase.findUniqueOrThrow({ where: { id: b } });
    const auditCount = await prisma.auditLog.count({ where: { projectId: project } });
    await phases.update(org, OrgRole.ADMIN, project, b, { dependencyIds: [a] });
    expect((await prisma.projectPhase.findUniqueOrThrow({ where: { id: b } })).updatedAt).toEqual(
      before.updatedAt,
    );
    expect(await prisma.auditLog.count({ where: { projectId: project } })).toBe(auditCount);
    const cleared = await phases.update(org, OrgRole.ADMIN, project, b, {
      objective: null,
      deliverables: [],
      acceptanceCriteria: [],
      requiredRoles: [],
      dependencyIds: [],
    });
    expect(cleared).toMatchObject({
      objective: null,
      deliverables: [],
      acceptanceCriteria: [],
      requiredRoles: [],
      dependencyIds: [],
    });
  });

  it('rejects self/foreign/multihop cycles and cross-project foreign keys without partial metadata changes', async () => {
    await phases.update(org, OrgRole.ADMIN, project, b, { dependencyIds: [a] });
    await phases.update(org, OrgRole.ADMIN, project, c, { dependencyIds: [b] });
    await expect(
      phases.update(org, OrgRole.ADMIN, project, a, { name: 'Rejected', dependencyIds: [c] }),
    ).rejects.toMatchObject({ code: 'PHASE_DEPENDENCY_CYCLE' });
    expect((await phases.findOne(org, project, a)).name).toBe('A');
    for (const ids of [[a], [foreignPhase], [b, b]])
      await expect(
        phases.update(org, OrgRole.ADMIN, project, a, { dependencyIds: ids }),
      ).rejects.toMatchObject({ code: 'INVALID_PHASE_DEPENDENCY' });
    await expect(
      phases.update(foreignOrg, OrgRole.OWNER, project, a, { dependencyIds: [] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      prisma.projectPhaseDependency.create({
        data: { projectId: project, phaseId: a, dependsOnPhaseId: foreignPhase },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.projectPhaseDependency.create({
        data: { projectId: project, phaseId: a, dependsOnPhaseId: a },
      }),
    ).rejects.toThrow();
    await phases.update(org, OrgRole.ADMIN, project, b, { dependencyIds: [] });
    await phases.update(org, OrgRole.ADMIN, project, c, { dependencyIds: [] });
  });

  it('serializes opposite dependency edits so concurrent requests cannot form a cycle', async () => {
    const results = await Promise.allSettled([
      phases.update(org, OrgRole.ADMIN, project, a, { dependencyIds: [b] }),
      phases.update(org, OrgRole.ADMIN, project, b, { dependencyIds: [a] }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: { code: 'PHASE_DEPENDENCY_CYCLE' },
    });
    await phases.update(org, OrgRole.ADMIN, project, a, { dependencyIds: [] });
    await phases.update(org, OrgRole.ADMIN, project, b, { dependencyIds: [] });
  });

  it('blocks prerequisite deletion until an explicit dependency edit and advances dependency-only timestamps', async () => {
    const prior = (await prisma.projectPhase.findUniqueOrThrow({ where: { id: c } })).updatedAt;
    await phases.update(org, OrgRole.ADMIN, project, c, { dependencyIds: [a] });
    expect(
      (await prisma.projectPhase.findUniqueOrThrow({ where: { id: c } })).updatedAt.getTime(),
    ).toBeGreaterThan(prior.getTime());
    await expect(phases.delete(org, OrgRole.ADMIN, project, a)).rejects.toMatchObject({
      code: 'PHASE_HAS_DEPENDENTS',
    });
    expect((await phases.findOne(org, project, c)).dependencyIds).toEqual([a]);
    await phases.update(org, OrgRole.ADMIN, project, c, { dependencyIds: [] });
    expect(await phases.delete(org, OrgRole.ADMIN, project, a)).toEqual({ id: a, deleted: true });
  });

  it('rolls contract and phase metadata/dependency writes back when audit fails', async () => {
    const failedAudit = {
      recordInTransaction: async () => {
        throw new Error('audit failed');
      },
    } as unknown as AuditService;
    const failedContract = new ProjectContractService(db, failedAudit);
    await expect(
      failedContract.replace(org, OrgRole.OWNER, project, { ...blank, objective: 'Reject me' }),
    ).rejects.toThrow('audit failed');
    expect(await contracts.read(org, project)).toEqual(blank);
    const failedPhase = new ProjectPhasesService(db, failedAudit);
    await expect(
      failedPhase.update(org, OrgRole.OWNER, project, b, {
        name: 'Reject phase',
        dependencyIds: [c],
      }),
    ).rejects.toThrow('audit failed');
    expect(await phases.findOne(org, project, b)).toMatchObject({
      name: 'Renamed B',
      dependencyIds: [],
    });
    const count = await prisma.projectPhase.count({ where: { projectId: project } });
    await expect(
      failedPhase.create(org, OrgRole.OWNER, project, {
        name: 'Rejected creation',
        dependencyIds: [c],
      }),
    ).rejects.toThrow('audit failed');
    expect(await prisma.projectPhase.count({ where: { projectId: project } })).toBe(count);
  });
});
