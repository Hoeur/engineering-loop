import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TaskStatus } from '@engloop/types';
import { PriorityBadge, SeverityBadge, StatusBadge } from '../common/badges';

describe('status badges', () => {
  it('renders every task status without throwing', () => {
    for (const status of Object.values(TaskStatus)) {
      const { unmount } = render(<StatusBadge status={status} />);
      unmount();
    }
  });

  it('humanises the status label', () => {
    render(<StatusBadge status={TaskStatus.NEEDS_HUMAN_REVIEW} />);
    expect(screen.getByText('Needs Human Review')).toBeInTheDocument();
  });

  it('marks a critical priority with the danger tone', () => {
    const { container } = render(<PriorityBadge priority="CRITICAL" />);
    expect(container.firstChild).toHaveClass('text-danger-strong');
  });

  it('marks a low severity with a non-danger tone', () => {
    const { container } = render(<SeverityBadge severity="LOW" />);
    expect(container.firstChild).not.toHaveClass('text-danger-strong');
  });
});
