import { describe, expect, it } from 'vitest';
import { replaceProjectTeamSchema } from '../src/project-team';

describe('replace project team contract', () => {
  it('requires a version and supports explicitly empty rosters', () => {
    expect(replaceProjectTeamSchema.parse({ expectedVersion: 0, agentIds: [] })).toEqual({
      expectedVersion: 0,
      agentIds: [],
    });
    expect(replaceProjectTeamSchema.safeParse({ agentIds: [] }).success).toBe(false);
  });
  it('rejects duplicates, excessive rosters, unknown fields and invalid versions', () => {
    for (const body of [
      { expectedVersion: 0, agentIds: ['agent-one', 'agent-one'] },
      { expectedVersion: 0, agentIds: Array.from({ length: 101 }, (_, i) => `agent-${i}`) },
      { expectedVersion: -1, agentIds: [] },
      { expectedVersion: 0.5, agentIds: [] },
      { expectedVersion: 0, agentIds: [], configured: false },
    ])
      expect(replaceProjectTeamSchema.safeParse(body).success).toBe(false);
  });
});
