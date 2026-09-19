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
