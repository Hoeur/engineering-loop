import { describe, expect, it, vi } from 'vitest';
import type { WorkerContext } from './context';
import { persistProviderHealth } from './health';

describe('persistProviderHealth', () => {
  it('stores each runtime provider check by provider key', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'provider-1', key: 'codex' }]);
    const update = vi.fn().mockResolvedValue({ id: 'provider-1' });
    const worker = {
      prisma: { agentProvider: { findMany, update } },
    } as unknown as WorkerContext;

    await persistProviderHealth(worker, {
      codex: {
        healthy: true,
        detail: 'codex-cli 0.153.4',
        checkedAt: '2026-09-08T12:00:00.000Z',
      },
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { enabled: true, key: { in: ['codex'] } },
      select: { id: true, key: true },
    });
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'provider-1' },
      data: {
        healthy: true,
        lastHealthCheckAt: new Date('2026-09-08T12:00:00.000Z'),
        lastHealthDetail: 'codex-cli 0.153.4',
      },
    });
  });
});
