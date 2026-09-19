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
