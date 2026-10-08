import { describe, expect, it } from 'vitest';
import {
  extractJson,
  implementationOutputSchema,
  parseSafely,
  plannerOutputSchema,
  reviewOutputSchema,
  SchemaValidationError,
  uiReviewOutputSchema,
} from '../src';

const validPlan = {
  summary: 'Ship invitations',
  approach: 'Model, API, UI',
  tasks: [{ title: 'Model', objective: 'Add the entity' }],
};

describe('planner output contract', () => {
  it('accepts a minimal valid plan and fills defaults', () => {
    const result = parseSafely(plannerOutputSchema, validPlan);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tasks[0]?.priority).toBe('MEDIUM');
      expect(result.data.risks).toEqual([]);
    }
  });

  it('rejects a plan with no tasks — a plan must produce work', () => {
    const result = parseSafely(plannerOutputSchema, { ...validPlan, tasks: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === 'tasks')).toBe(true);
    }
  });

  it('rejects free-form text where structured output is required', () => {
    expect(parseSafely(plannerOutputSchema, 'I made a plan!').ok).toBe(false);
  });

  const graphPlan = (dependencies: number[][]) => ({
    ...validPlan,
    tasks: dependencies.map((dependsOn, index) => ({
      title: `Task ${index}`,
      objective: 'Deliver bounded work',
      dependsOn,
    })),
  });

  it.each([
    ['self dependency', [[0]]],
    ['out-of-range dependency', [[1]]],
    ['duplicate dependency', [[], [0, 0]]],
    ['two-task cycle', [[1], [0]]],
    ['disconnected cycle', [[], [2], [1]]],
  ])('rejects a %s', (_name, dependencies) => {
    expect(plannerOutputSchema.safeParse(graphPlan(dependencies as number[][])).success).toBe(
      false,
    );
  });

  it('reports the invalid dependency path', () => {
    const result = plannerOutputSchema.safeParse(graphPlan([[], [2]]));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['tasks', 1, 'dependsOn', 0]);
  });

  it('accepts forward and backward references in a branching DAG', () => {
    expect(plannerOutputSchema.safeParse(graphPlan([[2], [0, 2], [], [1, 2]])).success).toBe(true);
  });

  it('validates deep graphs without a traversal limit', () => {
    const dependencies = Array.from({ length: 1200 }, (_, index) =>
      index === 0 ? [] : [index - 1],
    );
    expect(plannerOutputSchema.safeParse(graphPlan(dependencies)).success).toBe(true);
    dependencies[0] = [dependencies.length - 1];
    expect(plannerOutputSchema.safeParse(graphPlan(dependencies)).success).toBe(false);
  });
});

describe('review output contract', () => {
  const blocking = {
    severity: 'HIGH' as const,
    category: 'SECURITY' as const,
    problem: 'Token stored in plaintext',
    requiredFix: 'Hash it',
  };

  it('accepts an approval with no blocking findings', () => {
    const result = parseSafely(reviewOutputSchema, {
      decision: 'approved',
      score: 92,
      summary: 'Looks good',
      findings: [],
    });
    expect(result.ok).toBe(true);
  });

  it('refuses an approval that still reports a blocking finding', () => {
    const result = parseSafely(reviewOutputSchema, {
      decision: 'approved',
      score: 90,
      summary: 'Looks good',
      findings: [blocking],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes('blocking'))).toBe(true);
    }
  });

  it('accepts changes_requested with blocking findings', () => {
    const result = parseSafely(reviewOutputSchema, {
      decision: 'changes_requested',
      score: 40,
      summary: 'Needs work',
      findings: [blocking],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown severity', () => {
    const result = parseSafely(reviewOutputSchema, {
      decision: 'changes_requested',
      summary: 'x',
      findings: [{ ...blocking, severity: 'CATASTROPHIC' }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('implementation output contract', () => {
  it('accepts a complete implementation', () => {
    const result = parseSafely(implementationOutputSchema, {
      taskId: 'ENG-101',
      status: 'implementation_complete',
      summary: 'Done',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.commit).toBeNull();
  });

  it('rejects an unknown status', () => {
    expect(
      parseSafely(implementationOutputSchema, {
        taskId: 'x',
        status: 'kind_of_done',
        summary: 'Done',
      }).ok,
    ).toBe(false);
  });
});

describe('ui review contract', () => {
  it('validates viewport-scoped findings', () => {
    const result = parseSafely(uiReviewOutputSchema, {
      decision: 'changes_requested',
      summary: 'Overflow on mobile',
      findings: [
        {
          severity: 'MEDIUM',
          category: 'OVERFLOW',
          viewport: 'MOBILE',
          problem: 'Table scrolls sideways',
          requiredFix: 'Stack into cards',
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe('extractJson — CLI agents wrap output in prose', () => {
  it('reads a bare JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads a fenced JSON block', () => {
    expect(extractJson('Here you go:\n```json\n{"a":2}\n```\nHope that helps!')).toEqual({ a: 2 });
  });

  it('reads an object embedded in prose', () => {
    expect(extractJson('Result: {"a":3} — done')).toEqual({ a: 3 });
  });

  it('throws a typed error when there is no JSON at all', () => {
    expect(() => extractJson('no json here')).toThrow(SchemaValidationError);
  });
});
