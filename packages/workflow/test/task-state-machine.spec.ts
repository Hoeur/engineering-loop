import { describe, expect, it } from 'vitest';
import { TaskStatus } from '@engloop/types';
import { BOARD_COLUMNS, columnForStatus, InvalidTransitionError, taskStateMachine } from '../src';

describe('task state machine', () => {
  it('starts in BACKLOG and treats COMPLETED/CANCELLED as terminal', () => {
    expect(taskStateMachine.initial).toBe(TaskStatus.BACKLOG);
    expect(taskStateMachine.isTerminal(TaskStatus.COMPLETED)).toBe(true);
    expect(taskStateMachine.isTerminal(TaskStatus.CANCELLED)).toBe(true);
    expect(taskStateMachine.isTerminal(TaskStatus.REVIEWING)).toBe(false);
  });

  it('allows the happy path through the engineering loop', () => {
    const happyPath: TaskStatus[] = [
      TaskStatus.BACKLOG,
      TaskStatus.PLANNING,
      TaskStatus.PLAN_READY,
      TaskStatus.QUEUED,
      TaskStatus.IMPLEMENTING,
      TaskStatus.IMPLEMENTATION_READY,
      TaskStatus.TESTING,
      TaskStatus.REVIEWING,
      TaskStatus.APPROVED,
      TaskStatus.PR_READY,
      TaskStatus.PR_CREATED,
      TaskStatus.MERGED,
      TaskStatus.COMPLETED,
    ];

    for (let index = 0; index < happyPath.length - 1; index += 1) {
      const from = happyPath[index]!;
      const to = happyPath[index + 1]!;
      expect(taskStateMachine.can(from, to), `${from} → ${to}`).toBe(true);
    }
  });

  it('refuses the transition the spec calls out explicitly', () => {
    expect(taskStateMachine.can(TaskStatus.TESTING, TaskStatus.COMPLETED)).toBe(false);
    expect(() => taskStateMachine.assert(TaskStatus.TESTING, TaskStatus.COMPLETED)).toThrow(
      InvalidTransitionError,
    );
  });

  it('reports the allowed moves in the error', () => {
    try {
      taskStateMachine.assert(TaskStatus.BACKLOG, TaskStatus.MERGED);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      const typed = error as InvalidTransitionError;
      expect(typed.code).toBe('TASK_INVALID_TRANSITION');
      expect(typed.allowed).toContain(TaskStatus.PLANNING);
      expect(typed.allowed).not.toContain(TaskStatus.MERGED);
    }
  });

  it('never lets a task leave a terminal state', () => {
    expect(taskStateMachine.nextStates(TaskStatus.COMPLETED)).toHaveLength(0);
    expect(taskStateMachine.nextStates(TaskStatus.CANCELLED)).toHaveLength(0);
  });

  it('has no non-terminal dead ends', () => {
    expect(taskStateMachine.deadEnds()).toEqual([]);
  });

  it('finds the shortest path between two states', () => {
    const path = taskStateMachine.path(TaskStatus.BACKLOG, TaskStatus.TESTING);
    expect(path).not.toBeNull();
    expect(path?.[0]).toBe(TaskStatus.BACKLOG);
    expect(path?.[path.length - 1]).toBe(TaskStatus.TESTING);
  });

  it('routes a fix loop back to testing', () => {
    expect(taskStateMachine.can(TaskStatus.REVIEWING, TaskStatus.CHANGES_REQUESTED)).toBe(true);
    expect(taskStateMachine.can(TaskStatus.CHANGES_REQUESTED, TaskStatus.FIXING)).toBe(true);
    expect(taskStateMachine.can(TaskStatus.FIXING, TaskStatus.TESTING)).toBe(true);
  });

  it('escalates to a human from every stuck state', () => {
    for (const status of [
      TaskStatus.TEST_FAILED,
      TaskStatus.CHANGES_REQUESTED,
      TaskStatus.REVIEWING,
      TaskStatus.FAILED,
    ]) {
      expect(
        taskStateMachine.can(status, TaskStatus.NEEDS_HUMAN_REVIEW),
        `${status} → NEEDS_HUMAN_REVIEW`,
      ).toBe(true);
    }
  });
});

describe('board columns', () => {
  it('covers every task status exactly once', () => {
    const mapped = BOARD_COLUMNS.flatMap((column) => column.statuses as readonly TaskStatus[]);
    const unique = new Set(mapped);
    expect(unique.size).toBe(mapped.length);
    for (const status of Object.values(TaskStatus)) {
      expect(unique.has(status), `${status} is not on the board`).toBe(true);
    }
  });

  it('maps a status to its column', () => {
    expect(columnForStatus(TaskStatus.IMPLEMENTING)).toBe('in-progress');
    expect(columnForStatus(TaskStatus.COMPLETED)).toBe('completed');
  });
});
