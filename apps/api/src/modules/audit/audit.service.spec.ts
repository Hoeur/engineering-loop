import { AuditAction } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from './audit.service';

const input = {
  organizationId: 'org-1',
  projectId: 'project-1',
  taskId: 'task-1',
  action: AuditAction.TASK_TRANSITIONED,
  entityType: 'task',
  entityId: 'task-1',
  summary: 'Created ENG-101',
  metadata: { apiKey: 'must-not-leak', safe: 'visible' },
};

describe('AuditService transaction recording', () => {
  it('uses the supplied transaction with the same contextualized, scrubbed data', async () => {
    const regularCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const transactionCreate = vi.fn().mockResolvedValue({ id: 'audit-2' });
    const service = new AuditService({ auditLog: { create: regularCreate } } as never);
    const tx = { auditLog: { create: transactionCreate } };

    await service.record(input);
    await service.recordInTransaction(tx as never, input);

    expect(transactionCreate).toHaveBeenCalledOnce();
    expect(transactionCreate.mock.calls[0]?.[0]).toEqual(regularCreate.mock.calls[0]?.[0]);
    expect(JSON.stringify(transactionCreate.mock.calls[0]?.[0])).not.toContain('must-not-leak');
  });

  it('propagates transaction audit failures so the business transaction can roll back', async () => {
    const failure = new Error('audit insert failed');
    const service = new AuditService({} as PrismaService);
    const tx = { auditLog: { create: vi.fn().mockRejectedValue(failure) } };

    await expect(service.recordInTransaction(tx as never, input)).rejects.toBe(failure);
  });
});
