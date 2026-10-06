import { describe, expect, it } from 'vitest';
import { validatePhaseDependencies } from '../src/phase-dependencies';

describe('draft phase dependency graph', () => {
  const phases = ['a', 'b', 'c', 'd'];
  const edges = [
    { phaseId: 'b', dependsOnPhaseId: 'a' },
    { phaseId: 'c', dependsOnPhaseId: 'b' },
  ];
  it('allows independent phases and diamond dependencies', () => {
    expect(validatePhaseDependencies(phases, edges, 'd', ['a', 'c'])).toBeNull();
  });
  it('rejects duplicate, self and unknown targets', () => {
    expect(validatePhaseDependencies(phases, edges, 'd', ['a', 'a'])).toBe('DUPLICATE');
    expect(validatePhaseDependencies(phases, edges, 'a', ['a'])).toBe('SELF');
    expect(validatePhaseDependencies(phases, edges, 'a', ['foreign'])).toBe('FOREIGN');
  });
  it('rejects a multihop cycle and permits explicit removal', () => {
    expect(validatePhaseDependencies(phases, edges, 'a', ['c'])).toBe('CYCLE');
    expect(
      validatePhaseDependencies(
        phases,
        [...edges, { phaseId: 'a', dependsOnPhaseId: 'c' }],
        'a',
        [],
      ),
    ).toBeNull();
  });
  it('does not mutate input graph arrays', () => {
    const original = structuredClone(edges);
    validatePhaseDependencies(phases, edges, 'd', ['a']);
    expect(edges).toEqual(original);
  });
});
