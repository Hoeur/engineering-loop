import { describe, expect, it } from 'vitest';
import {
  createProjectPhaseSchema,
  updateProjectPhaseSchema,
  orderProjectPhasesSchema,
  replaceProjectContractSchema,
} from '../src/project-phases';

describe('draft phase contracts', () => {
  it('trims names and rejects fake lifecycle fields', () => {
    expect(createProjectPhaseSchema.parse({ name: ' Draft ' }).name).toBe('Draft');
    expect(createProjectPhaseSchema.safeParse({ name: 'Phase', status: 'ACCEPTED' }).success).toBe(
      false,
    );
    expect(createProjectPhaseSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(updateProjectPhaseSchema.safeParse({}).success).toBe(false);
    for (const status of ['DRAFT', 'ACTIVE', 'ACCEPTED'])
      expect(updateProjectPhaseSchema.safeParse({ name: 'Phase', status }).success).toBe(false);
  });
  it('rejects duplicate order IDs', () => {
    expect(orderProjectPhasesSchema.safeParse({ phaseIds: ['phase-a', 'phase-a'] }).success).toBe(
      false,
    );
  });
  it('validates full contract replacements and bounded normalized lists', () => {
    const contract = { objective: null, requirements: [], nonGoals: [], acceptanceCriteria: [] };
    expect(replaceProjectContractSchema.parse(contract)).toEqual(contract);
    expect(replaceProjectContractSchema.safeParse({ ...contract, objective: '  ' }).success).toBe(
      false,
    );
    expect(
      replaceProjectContractSchema.safeParse({ ...contract, requirements: ['Same', ' Same '] })
        .success,
    ).toBe(false);
    expect(
      replaceProjectContractSchema.safeParse({
        ...contract,
        requirements: Array.from({ length: 101 }, (_, index) => `r-${index}`),
      }).success,
    ).toBe(false);
    expect(replaceProjectContractSchema.safeParse({ objective: null }).success).toBe(false);
    expect(replaceProjectContractSchema.safeParse({ ...contract, activated: true }).success).toBe(
      false,
    );
  });
  it('supports omission and explicit phase clears but rejects repeated roles or dependencies', () => {
    expect(
      updateProjectPhaseSchema.parse({ objective: null, deliverables: [], dependencyIds: [] }),
    ).toEqual({ objective: null, deliverables: [], dependencyIds: [] });
    expect(
      createProjectPhaseSchema.safeParse({ name: 'Phase', requiredRoles: ['PLANNER', 'PLANNER'] })
        .success,
    ).toBe(false);
    expect(
      createProjectPhaseSchema.safeParse({ name: 'Phase', requiredRoles: ['FAKE_ROLE'] }).success,
    ).toBe(false);
    expect(
      createProjectPhaseSchema.safeParse({ name: 'Phase', dependencyIds: ['a', 'a'] }).success,
    ).toBe(false);
  });
});
