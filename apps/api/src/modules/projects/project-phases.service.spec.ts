import { describe, expect, it, vi } from 'vitest';
import { OrgRole } from '@engloop/types';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { ProjectPhasesService } from './project-phases.service';

describe('ProjectPhasesService policy', () => {
  it.each(['MEMBER', 'VIEWER', '', 'manager'])(
    'denies mutation role %s before any database access',
    async (role) => {
      const transaction = vi.fn();
      const service = new ProjectPhasesService(
        { $transaction: transaction } as unknown as PrismaService,
        {} as AuditService,
      );
      await expect(service.create('org', role, 'project', { name: 'Phase' })).rejects.toMatchObject(
        { code: 'FORBIDDEN' },
      );
      await expect(service.order('org', role, 'project', [])).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(service.delete('org', role, 'project', 'phase')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        service.membership('org', role, 'project', 'phase', 'task', true),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('does not enumerate phases when the organization does not own the project', async () => {
    const findMany = vi.fn();
    const service = new ProjectPhasesService(
      {
        project: { findFirst: vi.fn().mockResolvedValue(null) },
        projectPhase: { findMany },
      } as unknown as PrismaService,
      {} as AuditService,
    );
    await expect(service.list('foreign-org', 'project')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([{ ids: ['a'] }, { ids: ['a', 'a'] }, { ids: ['a', 'foreign'] }])(
    'rejects incomplete, duplicate or foreign permutations %j before writes',
    async ({ ids }) => {
      const update = vi.fn();
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'project' }]),
        projectPhase: { findMany: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]), update },
      };
      const service = new ProjectPhasesService(
        {
          $transaction: (callback: (value: unknown) => unknown) => callback(tx),
        } as unknown as PrismaService,
        {} as AuditService,
      );
      await expect(service.order('org', OrgRole.ADMIN, 'project', ids)).rejects.toMatchObject({
        code: 'INVALID_PHASE_ORDER',
      });
      expect(update).not.toHaveBeenCalled();
    },
  );
});
