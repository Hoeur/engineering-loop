import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectContract } from './project-contract';
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), user: vi.fn(), mutate: vi.fn() }));
vi.mock('@/lib/project-contract', () => ({
  useProjectContract: mocks.read,
  useSaveProjectContract: mocks.save,
}));
vi.mock('@/lib/queries', () => ({ useCurrentUser: mocks.user }));
const contract = { objective: null, requirements: [], nonGoals: [], acceptanceCriteria: [] };
const query = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
});
describe('ProjectContract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.read.mockReturnValue(query(contract));
    mocks.user.mockReturnValue(query({ role: 'OWNER' }));
    mocks.save.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
      mutate: mocks.mutate,
    });
  });
  it('saves trimmed requirements and supports explicit clearing', () => {
    render(<ProjectContract projectId="project-1" />);
    expect(screen.getByText('No objective specified.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit contract' }));
    fireEvent.change(screen.getByLabelText('Project objective'), {
      target: { value: '  Reliable delivery  ' },
    });
    fireEvent.change(screen.getByLabelText('Requirements (one per line)'), {
      target: { value: '  Audit writes \n\n Preserve history ' },
    });
    fireEvent.change(screen.getByLabelText('Non-goals (one per line)'), {
      target: { value: 'Replace legacy workflows' },
    });
    fireEvent.change(screen.getByLabelText('Project acceptance criteria (one per line)'), {
      target: { value: 'All checks pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save contract' }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        objective: 'Reliable delivery',
        requirements: ['Audit writes', 'Preserve history'],
        nonGoals: ['Replace legacy workflows'],
        acceptanceCriteria: ['All checks pass'],
      },
      expect.any(Object),
    );
    fireEvent.change(screen.getByLabelText('Project objective'), { target: { value: ' ' } });
    fireEvent.change(screen.getByLabelText('Requirements (one per line)'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save contract' }));
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ objective: null, requirements: [] }),
      expect.any(Object),
    );
  });
  it('shows read-only requirements to members', () => {
    mocks.user.mockReturnValue(query({ role: 'MEMBER' }));
    mocks.read.mockReturnValue(query({ ...contract, requirements: ['Audit writes'] }));
    render(<ProjectContract projectId="project-1" />);
    expect(screen.getByText('Audit writes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit contract' })).not.toBeInTheDocument();
  });
  it('preserves dirty edits on failed saves and refetches and blocks duplicate writes', () => {
    const { rerender } = render(<ProjectContract projectId="project-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit contract' }));
    fireEvent.change(screen.getByLabelText('Project objective'), {
      target: { value: 'My unsaved objective' },
    });
    mocks.read.mockReturnValue(query({ ...contract, objective: 'Other user update' }));
    mocks.save.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('Could not save contract'),
      reset: vi.fn(),
      mutate: mocks.mutate,
    });
    rerender(<ProjectContract projectId="project-1" />);
    expect(screen.getByLabelText('Project objective')).toHaveValue('My unsaved objective');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save contract');
    mocks.save.mockReturnValue({
      isPending: true,
      isError: false,
      reset: vi.fn(),
      mutate: mocks.mutate,
    });
    rerender(<ProjectContract projectId="project-1" />);
    expect(screen.getByRole('button', { name: 'Save contract' })).toBeDisabled();
  });
  it('renders loading and failed reads with retry', () => {
    mocks.read.mockReturnValue({ ...query(undefined), isLoading: true });
    const { rerender } = render(<ProjectContract projectId="project-1" />);
    expect(screen.getByText('Loading project contract…')).toBeInTheDocument();
    mocks.read.mockReturnValue({
      ...query(undefined),
      isError: true,
      error: new Error('Contract unavailable'),
    });
    rerender(<ProjectContract projectId="project-1" />);
    expect(screen.getByText(/Contract unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
