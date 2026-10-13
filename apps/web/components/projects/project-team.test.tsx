import { fireEvent, render, screen } from '@testing-library/react';
import { AgentRole } from '@engloop/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectTeam } from './project-team';
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), user: vi.fn(), mutate: vi.fn() }));
vi.mock('@/lib/project-team', () => ({
  useProjectTeam: mocks.read,
  useSaveProjectTeam: mocks.save,
}));
vi.mock('@/lib/queries', () => ({ useCurrentUser: mocks.user }));
const data = {
  configured: false,
  version: 0,
  expectedVersion: 0,
  memberIds: [],
  editable: true,
  agents: [
    {
      id: 'agent-one',
      name: 'Planner',
      role: AgentRole.PLANNER,
      eligible: true,
      unavailableReason: null,
      configuration: { id: 'config', version: 2 },
    },
    {
      id: 'agent-two',
      name: 'Disabled reviewer',
      role: AgentRole.CODE_REVIEWER,
      eligible: false,
      unavailableReason: 'Agent disabled',
      configuration: null,
    },
  ],
  coverage: {
    requiredRoles: [AgentRole.PLANNER],
    coveredRoles: [],
    missingRoles: [AgentRole.PLANNER],
  },
  phases: [
    {
      id: 'phase',
      name: 'Build',
      requiredRoles: [AgentRole.CODE_REVIEWER],
      coveredRoles: [],
      missingRoles: [AgentRole.CODE_REVIEWER],
    },
  ],
};
const query = (value: unknown) => ({
  data: value,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
});
describe('ProjectTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.read.mockReturnValue(query(data));
    mocks.user.mockReturnValue(query({ role: 'OWNER' }));
    mocks.save.mockReturnValue({
      isPending: false,
      isError: false,
      reset: vi.fn(),
      mutate: mocks.mutate,
    });
  });
  it('shows explicit empty membership and missing team/phase coverage', () => {
    render(<ProjectTeam projectId="project" />);
    expect(screen.getByText('No team members assigned.')).toBeInTheDocument();
    expect(screen.getByText('Missing roles: PLANNER')).toBeInTheDocument();
    expect(screen.getByText('Missing roles: CODE_REVIEWER')).toBeInTheDocument();
  });
  it('selects eligible members and requirements without changing permissions', () => {
    render(<ProjectTeam projectId="project" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit team' }));
    expect(screen.getByRole('checkbox', { name: /Disabled reviewer/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Planner (PLANNER)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'CODE_REVIEWER' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save team' }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        expectedVersion: 0,
        memberIds: ['agent-one'],
        requiredRoles: [AgentRole.PLANNER, AgentRole.CODE_REVIEWER],
      },
      expect.any(Object),
    );
  });
  it.each(['MEMBER', 'VIEWER', 'PLANNER'])('renders read-only for %s', (role) => {
    mocks.user.mockReturnValue(query({ role }));
    render(<ProjectTeam projectId="project" />);
    expect(screen.queryByRole('button', { name: 'Edit team' })).not.toBeInTheDocument();
  });
  it('hides edits while locked and shows unavailable existing members', () => {
    mocks.read.mockReturnValue(
      query({ ...data, editable: false, expectedVersion: 0, memberIds: ['agent-two'] }),
    );
    render(<ProjectTeam projectId="project" />);
    expect(screen.getByText(/Team edits are locked/)).toBeInTheDocument();
    expect(screen.getByText(/Disabled reviewer.*Agent disabled/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit team' })).not.toBeInTheDocument();
  });
  it('preserves draft selections on save failure and prevents duplicate submission', () => {
    const { rerender } = render(<ProjectTeam projectId="project" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit team' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Planner (PLANNER)' }));
    mocks.save.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('Forbidden'),
      reset: vi.fn(),
      mutate: mocks.mutate,
    });
    rerender(<ProjectTeam projectId="project" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Forbidden');
    expect(screen.getByRole('checkbox', { name: 'Planner (PLANNER)' })).toBeChecked();
    mocks.save.mockReturnValue({
      isPending: true,
      isError: false,
      reset: vi.fn(),
      mutate: mocks.mutate,
    });
    rerender(<ProjectTeam projectId="project" />);
    expect(screen.getByRole('button', { name: 'Save team' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Planner (PLANNER)' })).toBeDisabled();
  });
  it('keeps the original edit version after a concurrent team refetch', () => {
    const { rerender } = render(<ProjectTeam projectId="project" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit team' }));
    mocks.read.mockReturnValue(query({ ...data, version: 1 }));
    rerender(<ProjectTeam projectId="project" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save team' }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 0 }),
      expect.any(Object),
    );
  });
  it('allows removing an unavailable member and clearing all requirements', () => {
    mocks.read.mockReturnValue(query({ ...data, expectedVersion: 0, memberIds: ['agent-two'] }));
    render(<ProjectTeam projectId="project" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit team' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Disabled reviewer/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'PLANNER' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save team' }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      { expectedVersion: 0, memberIds: [], requiredRoles: [] },
      expect.any(Object),
    );
  });
  it('renders loading, errors and retry', () => {
    mocks.read.mockReturnValue({ ...query(undefined), isLoading: true });
    const { rerender } = render(<ProjectTeam projectId="project" />);
    expect(screen.getByText('Loading project team…')).toBeInTheDocument();
    const refetch = vi.fn();
    mocks.read.mockReturnValue({
      ...query(undefined),
      isError: true,
      error: new Error('Team unavailable'),
      refetch,
    });
    rerender(<ProjectTeam projectId="project" />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });
});
