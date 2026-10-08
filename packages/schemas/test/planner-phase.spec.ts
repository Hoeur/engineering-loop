import { describe, expect, it } from 'vitest';
import { plannerInputSchema, plannerOutputSchema } from '../src';

const scope = { phaseId: 'cphase12345678901234567890', phaseUpdatedAt: '2026-10-08T00:00:00.000Z' };
const task = {
  title: 'Bounded task',
  objective: 'Deliver this phase',
  ownerRole: 'IMPLEMENTER',
  acceptanceCriteria: ['Verified behavior'],
  requiredChecks: ['UNIT'],
  suggestedFiles: ['src/file.ts'],
};
const plan = () => ({
  summary: 'Phase plan',
  approach: 'Bounded increments',
  phaseScope: scope,
  tasks: [task],
});

describe('phase planner contract', () => {
  it('preserves binding and ownership through repeated provider boundary parsing', () => {
    const parsed = plannerOutputSchema.parse(plannerOutputSchema.parse(plan()));
    expect(parsed.phaseScope).toEqual(scope);
    expect(parsed.tasks[0]?.ownerRole).toBe('IMPLEMENTER');
  });
  it('keeps legacy plans compatible and unbounded by the scoped task limit', () => {
    expect(
      plannerOutputSchema.safeParse({
        summary: 'Legacy',
        approach: 'Legacy',
        tasks: Array.from({ length: 21 }, () => ({
          title: 'Legacy task',
          objective: 'Legacy objective',
        })),
      }).success,
    ).toBe(true);
  });
  it('enforces the scoped 20-task bound', () => {
    expect(
      plannerOutputSchema.safeParse({ ...plan(), tasks: Array.from({ length: 21 }, () => task) })
        .success,
    ).toBe(false);
  });
  it.each([
    { ownerRole: undefined },
    { ownerRole: 'INVALID' },
    { title: '   ' },
    { objective: '  ' },
    { objective: 'x'.repeat(4001) },
    { acceptanceCriteria: [] },
    { acceptanceCriteria: [' '] },
    { requiredChecks: [] },
    { suggestedFiles: ['../secret'] },
    { suggestedFiles: ['C:/secret'] },
    { suggestedFiles: ['/tmp/file'] },
    { suggestedFiles: ['src\\file.ts'] },
    { suggestedFiles: ['.git/config'] },
    { suggestedFiles: ['workspace/repositories/repo/source.ts'] },
  ])('rejects malformed scoped tasks %j', (change) => {
    expect(
      plannerOutputSchema.safeParse({ ...plan(), tasks: [{ ...task, ...change }] }).success,
    ).toBe(false);
  });
  it('validates strict input phase metadata', () => {
    const phaseContext = {
      ...scope,
      projectRequirements: ['Build a service'],
      projectObjective: null,
      projectNonGoals: [],
      projectAcceptanceCriteria: [],
      name: 'Service',
      objective: null,
      deliverables: [],
      acceptanceCriteria: [],
      requiredRoles: ['IMPLEMENTER'],
    };
    expect(plannerInputSchema.parse({ requirement: 'Service', phaseContext }).phaseContext).toEqual(
      phaseContext,
    );
    expect(
      plannerInputSchema.safeParse({
        requirement: 'Service',
        phaseContext: { ...phaseContext, phaseUpdatedAt: 'yesterday' },
      }).success,
    ).toBe(false);
    expect(
      plannerInputSchema.safeParse({
        requirement: 'Service',
        phaseContext: { ...phaseContext, arbitraryProject: 'other' },
      }).success,
    ).toBe(false);
  });
});
