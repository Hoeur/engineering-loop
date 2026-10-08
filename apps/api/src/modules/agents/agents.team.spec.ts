import { describe, expect, it, vi } from 'vitest';
import { AgentsService } from './agents.service';

describe('AgentsService project team scoping', () => {
  it('rejects foreign project IDs before reading candidate agents', async () => {
    const findMany = vi.fn();
    const service = new AgentsService(
      { project: { findFirst: vi.fn().mockResolvedValue(null) }, agent: { findMany } } as never,
      {} as never,
    );
    await expect(service.team('org', 'foreign')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(findMany).not.toHaveBeenCalled();
  });
  it('keeps the legacy response shape and restricts configured teams to eligible members', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new AgentsService(
      {
        project: {
          findFirst: vi.fn().mockResolvedValue({ teamConfigured: true, roleAssignments: {} }),
        },
        agent: { findMany },
      } as never,
      {} as never,
    );
    const result = await service.team('org', 'project');
    expect(result).toMatchObject({ items: expect.any(Array), meta: { totalAgents: 0 } });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org',
          enabled: true,
          OR: [{ projectId: 'project' }, { projectId: null }],
          provider: { organizationId: 'org', enabled: true },
          teamMemberships: { some: { projectId: 'project' } },
        },
      }),
    );
  });
});
