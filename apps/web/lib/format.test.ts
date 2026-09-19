import { describe, expect, it } from 'vitest';
import { formatCost, formatDuration, formatTokens, initials, titleCase } from './format';

describe('formatters', () => {
  it('formats durations across magnitudes', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(450)).toBe('450ms');
    expect(formatDuration(4_500)).toBe('4.5s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(7_500_000)).toBe('2h 5m');
  });

  it('keeps sub-cent costs visible instead of rounding them to zero', () => {
    expect(formatCost(0.0034)).toBe('$0.0034');
    expect(formatCost(12.5)).toBe('$12.50');
    expect(formatCost('0.75')).toBe('$0.75');
    expect(formatCost(null)).toBe('$0.00');
  });

  it('abbreviates token counts', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(12_400)).toBe('12.4k');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });

  it('humanises SCREAMING_SNAKE enum values', () => {
    expect(titleCase('NEEDS_HUMAN_REVIEW')).toBe('Needs Human Review');
    expect(titleCase('LOW')).toBe('Low');
  });

  it('builds agent initials', () => {
    expect(initials('Claude Code')).toBe('CC');
    expect(initials('Forge')).toBe('F');
  });
});
