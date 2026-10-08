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

describe('ContextBuilder agent budget resolution', () => {
  const builderFor = (agent: unknown) =>
    new ContextBuilder(
      {
        project: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'project-1',
            organizationId: 'org-1',
            roleAssignments: { IMPLEMENTER: 'agent-1' },
            organization: { defaultProviderKey: 'mock' },
          }),
        },
        agent: { findFirst: vi.fn().mockResolvedValue(agent) },
      } as never,
      {} as never,
    );

  it("carries the agent row's own token and cost limits, not just its timeout", async () => {
    const builder = builderFor({
      id: 'agent-1',
      model: null,
      timeoutMs: 1000,
      maxTokens: 50_000,
      // Prisma hands this back as a Decimal-like value, not a number.
      maxCostUsd: { toString: () => '2.5' },
      provider: { key: 'codex', defaultModel: 'model', enabled: true },
    });

    await expect(
      builder.resolveRoleProvider('project-1', AgentRole.IMPLEMENTER),
    ).resolves.toMatchObject({
      agentTimeoutMs: 1000,
      agentMaxTokens: 50_000,
      agentMaxCostUsd: 2.5,
    });
  });

  it('reports no agent limits when no agent row serves the role', async () => {
    const builder = builderFor(null);

    const resolution = await builder.resolveRoleProvider('project-1', AgentRole.IMPLEMENTER);

    // Omitted rather than null, so the env-wide defaults stay in force.
    expect(resolution.agentId).toBeNull();
    expect(resolution).not.toHaveProperty('agentMaxTokens');
    expect(resolution).not.toHaveProperty('agentMaxCostUsd');
  });
});

describe('ContextBuilder explicit project roster', () => {
  function configured(agent: unknown, assigned = 'outsider') {
    const findFirst = vi.fn().mockResolvedValue(agent);
    const builder = new ContextBuilder(
      {
        project: {
          findUniqueOrThrow: vi
            .fn()
            .mockResolvedValue({
              organizationId: 'org-1',
              teamConfigured: true,
              roleAssignments: { IMPLEMENTER: assigned },
              organization: { defaultProviderKey: 'mock' },
            }),
        },
        agent: { findFirst },
      } as never,
      { AGENT_DEFAULT_PROVIDER: 'mock' } as never,
    );
    return { builder, findFirst };
  }

  it('restricts both preferred assignment and every fallback to eligible members', async () => {
    const { builder, findFirst } = configured(null);
    await expect(builder.resolveRoleProvider('project-1', AgentRole.IMPLEMENTER)).rejects.toThrow(
      'PROJECT_TEAM_ROLE_UNCOVERED',
    );
    expect(findFirst).toHaveBeenCalledTimes(3);
    for (const [query] of findFirst.mock.calls) {
      expect(query.where).toMatchObject({
        teamMemberships: { some: { projectId: 'project-1' } },
        enabled: true,
        organizationId: 'org-1',
        role: AgentRole.IMPLEMENTER,
        provider: { organizationId: 'org-1', enabled: true },
      });
    }
    expect(findFirst.mock.calls[1]?.[0].orderBy).toEqual({ id: 'asc' });
    expect(findFirst.mock.calls[2]?.[0].orderBy).toEqual({ id: 'asc' });
  });

  it('falls back to a roster member when the preferred assignment is outside the roster', async () => {
    const { builder, findFirst } = configured(null);
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'member',
        model: 'chosen',
        maxCostUsd: 1,
        maxTokens: 10,
        timeoutMs: 100,
        provider: { key: 'codex', enabled: true },
      });
    expect(await builder.resolveRoleProvider('project-1', AgentRole.IMPLEMENTER)).toMatchObject({
      agentId: 'member',
      providerKey: 'codex',
    });
  });
});
