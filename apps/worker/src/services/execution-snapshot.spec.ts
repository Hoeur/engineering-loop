import { describe, expect, it } from 'vitest';
import { plannedSnapshotContract, readExecutionSnapshot } from './execution-snapshot';
import { snapshotFixture } from './execution-snapshot.fixture';

const owner = { organizationId: 'org-1', projectId: 'project-1', taskId: 'task-1' };

describe('execution snapshot trust boundary', () => {
  it.each([null, undefined])('retains legacy handling for absent snapshot %s', (value) => {
    expect(readExecutionSnapshot(value, owner)).toBeUndefined();
  });

  it.each([{}, { version: 2 }, { ...snapshotFixture(), unexpectedCredential: 'secret' }])(
    'rejects a present invalid payload rather than treating it as legacy',
    (value) => {
      expect(() => readExecutionSnapshot(value, owner)).toThrow();
    },
  );

  it.each(['organizationId', 'projectId', 'taskId'] as const)('rejects foreign %s', (field) => {
    expect(() =>
      readExecutionSnapshot(snapshotFixture(), { ...owner, [field]: 'foreign' }),
    ).toThrow('does not belong');
  });

  it('rejects internally mismatched task identifiers', () => {
    const snapshot = snapshotFixture();
    snapshot.task.id = 'foreign';
    expect(() => readExecutionSnapshot(snapshot, owner)).toThrow();
  });

  it('retains frozen baseline checks when a validated plan adds new evidence requirements', () => {
    const snapshot = snapshotFixture();
    snapshot.task.requiredChecks = ['LINT'];
    const result = plannedSnapshotContract(snapshot, [
      {
        stepKey: 'PLAN',
        status: 'SUCCEEDED',
        output: {
          summary: 'Plan',
          approach: 'Implement and verify',
          tasks: [{ title: 'Implement', objective: 'Verify behavior' }],
          acceptanceCriteria: ['Original criterion', 'Planner criterion'],
          requiredChecks: ['UNIT', 'E2E'],
        },
      },
    ]);
    expect(result.requiredChecks).toEqual(['LINT', 'UNIT', 'E2E']);
    expect(result.acceptanceCriteria).toEqual(['Original criterion', 'Planner criterion']);
  });

  it('ignores failed planning output and rejects invalid successful output', () => {
    const snapshot = snapshotFixture();
    expect(
      plannedSnapshotContract(snapshot, [{ stepKey: 'PLAN', status: 'FAILED', output: {} }]),
    ).toEqual({
      requiredChecks: snapshot.task.requiredChecks,
      acceptanceCriteria: snapshot.task.acceptanceCriteria,
    });
    expect(() =>
      plannedSnapshotContract(snapshot, [{ stepKey: 'PLAN', status: 'SUCCEEDED', output: {} }]),
    ).toThrow();
  });
});
