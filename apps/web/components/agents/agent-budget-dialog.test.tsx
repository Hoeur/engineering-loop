import { describe, expect, it } from 'vitest';
import { validateBudget } from './agent-budget-dialog';

const valid = { maxTokens: '200000', maxCostUsd: '5', timeoutMs: '900000', maxRetries: '2' };

describe('validateBudget', () => {
  it('accepts the default limits', () => {
    expect(validateBudget(valid)).toBeNull();
  });

  it('accepts a zero cost limit, which blocks paid runs outright', () => {
    expect(validateBudget({ ...valid, maxCostUsd: '0' })).toBeNull();
  });

  it('accepts a fractional cost limit', () => {
    expect(validateBudget({ ...valid, maxCostUsd: '2.5' })).toBeNull();
  });

  it.each([
    ['a zero token limit', { maxTokens: '0' }],
    ['a fractional token limit', { maxTokens: '1.5' }],
    ['a non-numeric token limit', { maxTokens: 'lots' }],
    ['a negative cost limit', { maxCostUsd: '-1' }],
    ['a zero timeout', { timeoutMs: '0' }],
    ['a negative retry count', { maxRetries: '-1' }],
    ['more retries than the API allows', { maxRetries: '11' }],
  ])('rejects %s', (_label, patch) => {
    expect(validateBudget({ ...valid, ...patch })).toBeTypeOf('string');
  });
});
