import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPhases } from './project-phases';

const mocks = vi.hoisted(() => ({
  phases: vi.fn(),
  detail: vi.fn(),
  change: vi.fn(),
  user: vi.fn(),
  board: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock('@/lib/project-phases', () => ({
  useProjectPhases: mocks.phases,
  usePhaseDetail: mocks.detail,
  usePhaseChange: mocks.change,
}));
vi.mock('@/lib/queries', () => ({ useCurrentUser: mocks.user, useBoard: mocks.board }));
const phase = {
  status: 'DRAFT',
  id: 'phase-1',
  projectId: 'project-1',
  name: 'Foundation',
  description: 'Build the domain',
  position: 0,
  _count: { tasks: 1 },
  objective: null,
  deliverables: [],
  acceptanceCriteria: [],
  requiredRoles: [],
  dependencyIds: [],
};
const query = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
});

describe('ProjectPhases', () => {
  it('normalizes metadata lines, selects roles and excludes self dependencies', () => {
    render(<ProjectPhases projectId="project-1" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    expect(screen.queryByRole('checkbox', { name: 'Foundation' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Phase objective'), {
      target: { value: '  Ship the domain  ' },
    });
    fireEvent.change(screen.getByLabelText('Deliverables (one per line)'), {
      target: { value: '  Schema  \n\n API routes ' },
    });
    fireEvent.change(screen.getByLabelText('Phase acceptance criteria (one per line)'), {
      target: { value: 'Tests pass' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'PLANNER' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Delivery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save phase' }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        kind: 'update',
        phaseId: 'phase-1',
        fields: {
          name: 'Foundation',
          description: 'Build the domain',
          objective: 'Ship the domain',
          deliverables: ['Schema', 'API routes'],
          acceptanceCriteria: ['Tests pass'],
          requiredRoles: ['PLANNER'],
          dependencyIds: ['phase-2'],
        },
      },
      expect.any(Object),
    );
  });
  it('keeps rejected dependency edits when a refetch returns old metadata', () => {
    const { rerender } = render(<ProjectPhases projectId="project-1" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    fireEvent.change(screen.getByLabelText('Phase objective'), {
      target: { value: 'Unsaved objective' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Delivery' }));
    mocks.change.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('Phase dependencies contain a cycle'),
      reset: vi.fn(),
      mutate: mocks.mutate,
    });
    mocks.phases.mockReturnValue(
      query({
        items: [
          { ...phase, objective: 'Server objective' },
          { ...phase, id: 'phase-2', name: 'Delivery' },
        ],
      }),
    );
    rerender(<ProjectPhases projectId="project-1" />);
    expect(screen.getByLabelText('Phase objective')).toHaveValue('Unsaved objective');
    expect(screen.getByRole('checkbox', { name: 'Delivery' })).toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent('cycle');
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phases.mockReturnValue(
      query({ items: [phase, { ...phase, id: 'phase-2', name: 'Delivery', position: 1 }] }),
    );
    mocks.detail.mockImplementation((_projectId: string, phaseId: string) =>
      query({
        tasks:
          phaseId === 'phase-1' ? [{ id: 'task-1', key: 'ENG-1', title: 'Define schema' }] : [],
      }),
    );
    mocks.change.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
      mutate: mocks.mutate,
    });
    mocks.user.mockReturnValue(query({ role: 'OWNER' }));
    mocks.board.mockReturnValue(
      query({
        items: [
          { id: 'task-1', key: 'ENG-1', title: 'Define schema', phaseId: 'phase-1' },
          { id: 'task-2', key: 'ENG-2', title: 'Build API', phaseId: null },
        ],
      }),
    );
  });

  it('creates and edits phases using validated names and description clearing', () => {
    render(<ProjectPhases projectId="project-1" />);
    fireEvent.change(screen.getByLabelText('Phase name'), { target: { value: '  Review  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add phase' }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        kind: 'create',
        fields: {
          name: 'Review',
          description: null,
          objective: null,
          deliverables: [],
          acceptanceCriteria: [],
          requiredRoles: [],
          dependencyIds: [],
        },
      },
      expect.any(Object),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    expect(screen.getByLabelText('Phase name')).toHaveValue('Foundation');
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save phase' }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        kind: 'update',
        phaseId: 'phase-1',
        fields: {
          name: 'Foundation',
          description: null,
          objective: null,
          deliverables: [],
          acceptanceCriteria: [],
          requiredRoles: [],
          dependencyIds: [],
        },
      },
      expect.any(Object),
    );
  });

  it('orders by a complete permutation and confirms deletion with tasks preserved', () => {
    render(<ProjectPhases projectId="project-1" />);
    expect(screen.getByRole('button', { name: 'Move Foundation up' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move Foundation down' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ kind: 'order', phaseIds: ['phase-2', 'phase-1'] });
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    expect(screen.getByText(/tasks will remain/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ kind: 'delete', phaseId: 'phase-1' });
  });

  it('links an available task and unlinks an existing member', () => {
    render(<ProjectPhases projectId="project-1" />);
    fireEvent.change(screen.getAllByLabelText('Link or move an existing project task')[0]!, {
      target: { value: 'task-2' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Link task' })[0]!);
    expect(mocks.mutate).toHaveBeenCalledWith({
      kind: 'link',
      phaseId: 'phase-1',
      taskId: 'task-2',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlink ENG-1' }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      kind: 'unlink',
      phaseId: 'phase-1',
      taskId: 'task-1',
    });
  });

  it('renders draft read-only phases for members without manager controls', () => {
    mocks.user.mockReturnValue(query({ role: 'MEMBER' }));
    render(<ProjectPhases projectId="project-1" />);
    expect(screen.getByText(/does not schedule or start work/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add phase' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate phase' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ENG-1 · Define schema' })).toBeInTheDocument();
  });

  it('shows loading, empty and failed phase reads', () => {
    mocks.phases.mockReturnValue({ ...query(undefined), isLoading: true });
    const { rerender } = render(<ProjectPhases projectId="project-1" />);
    expect(screen.getByText('Loading project phases…')).toBeInTheDocument();
    mocks.phases.mockReturnValue(query({ items: [] }));
    rerender(<ProjectPhases projectId="project-1" />);
    expect(screen.getByText('No phases yet')).toBeInTheDocument();
    mocks.phases.mockReturnValue({
      ...query(undefined),
      isError: true,
      error: new Error('Phase list unavailable'),
    });
    rerender(<ProjectPhases projectId="project-1" />);
    expect(screen.getByText(/Phase list unavailable/)).toBeInTheDocument();
  });

  it('shows mutation errors and disables writes while changes are pending', () => {
    mocks.change.mockReturnValue({
      isPending: true,
      isError: false,
      reset: vi.fn(),
      mutate: mocks.mutate,
    });
    const { rerender } = render(<ProjectPhases projectId="project-1" />);
    expect(screen.getByRole('button', { name: 'Add phase' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Edit' })[0]).toBeDisabled();
    expect(screen.getByText('Saving phase changes…')).toBeInTheDocument();
    mocks.change.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('A running task cannot be moved'),
      reset: vi.fn(),
      mutate: mocks.mutate,
    });
    rerender(<ProjectPhases projectId="project-1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('A running task cannot be moved');
  });
  it('confirms activation and reopening, and locks metadata and membership', () => {
    const { rerender } = render(<ProjectPhases projectId="project-1" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Activate phase' })[0]!);
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/All prerequisite phases must be accepted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm activation' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ kind: 'activate', phaseId: 'phase-1' });
    mocks.phases.mockReturnValue(
      query({
        items: [
          { ...phase, status: 'ACTIVE' },
          { ...phase, id: 'phase-2', name: 'Delivery' },
        ],
      }),
    );
    rerender(<ProjectPhases projectId="project-1" />);
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Delete' })[0]).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Delivery up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Unlink ENG-1' })).toBeDisabled();
    expect(screen.getAllByLabelText('Link or move an existing project task')[0]).toBeDisabled();
    expect(
      screen.getAllByLabelText('Link or move an existing project task')[1],
    ).not.toHaveTextContent('ENG-1');
    fireEvent.click(screen.getByRole('button', { name: 'Reopen draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reopen' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ kind: 'reopen', phaseId: 'phase-1' });
  });

  it('locks accepted phases and prevents deletion shifting locked positions', () => {
    mocks.phases.mockReturnValue(
      query({ items: [phase, { ...phase, id: 'phase-2', name: 'Delivery', status: 'ACCEPTED' }] }),
    );
    render(<ProjectPhases projectId="project-1" />);
    expect(screen.getAllByRole('button', { name: 'Delete' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Edit' })[1]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Activate phase' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Reopen draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept phase' })).not.toBeInTheDocument();
  });

  it('preserves in-flight form edits but blocks saving after concurrent activation', () => {
    const { rerender } = render(<ProjectPhases projectId="project-1" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    fireEvent.change(screen.getByLabelText('Phase objective'), { target: { value: 'Unsaved' } });
    mocks.phases.mockReturnValue(query({ items: [{ ...phase, status: 'ACTIVE' }] }));
    rerender(<ProjectPhases projectId="project-1" />);
    expect(screen.getByLabelText('Phase objective')).toHaveValue('Unsaved');
    expect(screen.getByRole('button', { name: 'Save phase' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel edit' })).toBeEnabled();
  });
});
