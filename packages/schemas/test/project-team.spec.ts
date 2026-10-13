import { describe, expect, it } from 'vitest';
import { AgentRole } from '@engloop/types';
import { replaceProjectTeamSchema } from '../src/project-team';

describe('explicit project team schema', () => {
  it('requires a bounded integer version to prevent lost edits', () => {
    for (const expectedVersion of [undefined, -1, 0.5, 2_147_483_647])
      expect(
        replaceProjectTeamSchema.safeParse({ expectedVersion, memberIds: [], requiredRoles: [] })
          .success,
      ).toBe(false);
  });
  it('allows an empty team and missing coverage during planning', () => {
    expect(
      replaceProjectTeamSchema.parse({
        expectedVersion: 0,
        memberIds: [],
        requiredRoles: [AgentRole.CODE_REVIEWER],
      }),
    ).toEqual({ expectedVersion: 0, memberIds: [], requiredRoles: [AgentRole.CODE_REVIEWER] });
  });
  it.each([
    { expectedVersion: 0, memberIds: ['agent-one', 'agent-one'], requiredRoles: [] },
    { expectedVersion: 0, memberIds: [], requiredRoles: [AgentRole.PLANNER, AgentRole.PLANNER] },
    { expectedVersion: 0, memberIds: [], requiredRoles: ['ADMIN'] },
    { expectedVersion: 0, memberIds: [], requiredRoles: [], permissionLevel: 'LEVEL_5_FULL' },
    { expectedVersion: 0, memberIds: [], requiredRoles: [], configurations: [{ secret: 'value' }] },
    {
      expectedVersion: 0,
      memberIds: Array.from({ length: 101 }, (_, i) => `agent-${i}`),
      requiredRoles: [],
    },
  ])('rejects invalid or authority-changing input %j', (input) => {
    expect(replaceProjectTeamSchema.safeParse(input).success).toBe(false);
  });
});
