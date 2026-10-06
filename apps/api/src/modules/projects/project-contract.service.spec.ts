import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { ProjectContractService } from './project-contract.service';

describe('ProjectContractService scope and permissions', () => {
  it.each(['MEMBER', 'VIEWER', ''])(
    'rejects contract writes by %s before accessing the database',
    async (role) => {
      const transaction = vi.fn();
      const service = new ProjectContractService(
        { $transaction: transaction } as unknown as PrismaService,
        {} as AuditService,
      );
      await expect(
        service.replace('org', role, 'project', {
          objective: null,
          requirements: [],
          nonGoals: [],
          acceptanceCriteria: [],
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('scopes contract reads to the current organization', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new ProjectContractService(
      { project: { findFirst } } as unknown as PrismaService,
      {} as AuditService,
    );
    await expect(service.read('foreign-org', 'project')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'project', organizationId: 'foreign-org' } }),
    );
  });
});
