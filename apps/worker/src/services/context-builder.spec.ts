import { AgentRole } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import { ContextBuilder } from './context-builder';

describe('ContextBuilder assigned role assignment scoping', () => {
  it('accepts an assigned agent only through tenant, project, role, enabled, and provider scope', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'agent-1',
      model: null,
      timeoutMs: 1000,
      provider: { key: 'codex', defaultModel: 'model', enabled: true },
    });
    const builder = new ContextBuilder(
      {
        project: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'project-1',
            organizationId: 'org-1',
            roleAssignments: { IMPLEMENTER: 'agent-1' },
            organization: { defaultProviderKey: 'mock' },
          }),
        },
        agent: { findFirst },
      } as never,
      {} as never,
    );

    await expect(
      builder.resolveRoleProvider('project-1', AgentRole.IMPLEMENTER),
    ).resolves.toMatchObject({ agentId: 'agent-1', providerKey: 'codex' });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'agent-1',
          organizationId: 'org-1',
          role: AgentRole.IMPLEMENTER,
          enabled: true,
          OR: [{ projectId: null }, { projectId: 'project-1' }],
          provider: { organizationId: 'org-1', enabled: true },
        },
      }),
    );
  });
});
