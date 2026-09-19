import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { EmptyState, ErrorState, LoadingState } from '../common/states';

describe('screen states', () => {
  it('renders a labelled loading state', () => {
    render(<LoadingState label="Loading tasks…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading tasks…');
  });

  it('renders an empty state with guidance', () => {
    render(<EmptyState title="No tasks" description="Create one to get started." />);
    expect(screen.getByText('No tasks')).toBeInTheDocument();
    expect(screen.getByText('Create one to get started.')).toBeInTheDocument();
  });

  it('shows the connection-problem state when the API is unreachable', () => {
    render(<ErrorState error={new ApiError('CONNECTION_FAILED', 'fetch failed', 0)} />);
    expect(screen.getByText('Cannot reach the EngLoop API')).toBeInTheDocument();
  });

  it('shows the permission-denied state on 403', () => {
    render(<ErrorState error={new ApiError('FORBIDDEN', 'nope', 403)} />);
    expect(screen.getByText('You do not have access to this')).toBeInTheDocument();
  });

  it('shows the not-found state on 404', () => {
    render(<ErrorState error={new ApiError('NOT_FOUND', 'gone', 404)} entity="Task" />);
    expect(screen.getByText('Task not found')).toBeInTheDocument();
  });

  it('falls back to a generic error with the code', () => {
    render(<ErrorState error={new ApiError('TASK_INVALID_TRANSITION', 'bad move', 409)} />);
    expect(screen.getByText(/TASK_INVALID_TRANSITION/)).toBeInTheDocument();
  });
});
