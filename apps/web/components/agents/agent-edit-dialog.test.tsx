import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRole, PermissionLevel } from '@engloop/types';
import type { AgentEditorDetails } from '@/lib/agent-editing';
import { AgentEditDialog } from './agent-edit-dialog';

const agent: AgentEditorDetails = {
  id: 'agent-one',
  name: 'Implementer',
  role: AgentRole.IMPLEMENTER,
  model: 'original-model',
  enabled: true,
  projectId: null,
  systemPrompt: 'Original instructions',
  updatedAt: '2026-10-27T00:00:00.000Z',
  permissionLevel: PermissionLevel.LEVEL_3_PR,
  maxTokens: 200000,
  maxCostUsd: '5',
  timeoutMs: 900000,
  maxRetries: 2,
  allowedCommands: [],
  provider: { key: 'mock', displayName: 'Mock', kind: 'MOCK' },
};
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  reload: vi.fn(),
  retryProviders: vi.fn(),
  role: 'OWNER',
  details: undefined as AgentEditorDetails | undefined,
  loading: false,
  loadError: false,
  providersError: false,
  pending: false,
}));
vi.mock('@/lib/agent-editing', () => ({
  useAgentEditor: () => ({
    data: mocks.details,
    isLoading: mocks.loading,
    isError: mocks.loadError,
    error: new Error('Cannot load agent'),
    refetch: mocks.reload,
  }),
  useSaveAgent: () => ({ mutateAsync: mocks.save, isPending: mocks.pending }),
}));
vi.mock('@/lib/queries', () => ({
  useCurrentUser: () => ({ data: { organizationId: 'org-one', role: mocks.role } }),
  useProjects: () => ({ data: { items: [{ id: 'project-one', name: 'Project one' }] } }),
  useProviders: () => ({
    data: { items: [{ key: 'mock', displayName: 'Mock', enabled: true }] },
    isLoading: false,
    isError: mocks.providersError,
    refetch: mocks.retryProviders,
  }),
}));
beforeEach(() => {
  mocks.role = 'OWNER';
  mocks.details = agent;
  mocks.loading = false;
  mocks.loadError = false;
  mocks.providersError = false;
  mocks.pending = false;
  mocks.save.mockReset().mockResolvedValue(agent);
  mocks.reload.mockReset();
  mocks.retryProviders.mockReset();
});
const openEdit = () => {
  render(<AgentEditDialog agent={agent} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }));
};
describe('General agent editor', () => {
  it('creates an agent with authenticated organization scope and shared schema validation', async () => {
    render(<AgentEditDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('name');
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New planner' } });
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'mock' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'PLANNER' } });
    fireEvent.change(screen.getByLabelText('Project scope'), { target: { value: 'project-one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        body: expect.objectContaining({
          organizationId: 'org-one',
          projectId: 'project-one',
          name: 'New planner',
          role: 'PLANNER',
          providerKey: 'mock',
          configuration: {},
        }),
      }),
    );
  });
  it('edits only changed settings with the loaded version', async () => {
    openEdit();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated implementer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        id: agent.id,
        body: { name: 'Updated implementer', expectedUpdatedAt: agent.updatedAt },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('retains draft and original version after a conflict and refetch', async () => {
    mocks.save.mockRejectedValue(new Error('Agent changed; reload before saving'));
    const view = render(<AgentEditDialog agent={agent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }));
    fireEvent.change(screen.getByLabelText('System prompt'), {
      target: { value: 'My draft instructions' },
    });
    mocks.details = {
      ...agent,
      updatedAt: '2026-10-27T01:00:00.000Z',
      systemPrompt: 'Other instructions',
    };
    view.rerender(<AgentEditDialog agent={agent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Agent changed');
    expect(screen.getByLabelText('System prompt')).toHaveValue('My draft instructions');
    expect(mocks.save).toHaveBeenCalledWith({
      id: agent.id,
      body: { systemPrompt: 'My draft instructions', expectedUpdatedAt: agent.updatedAt },
    });
  });
  it('explicitly reloads saved settings before another edit', async () => {
    openEdit();
    mocks.reload.mockResolvedValue({
      data: { ...agent, name: 'New saved name', updatedAt: '2026-10-27T01:00:00.000Z' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved agent' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('New saved name'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Final name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        id: agent.id,
        body: { name: 'Final name', expectedUpdatedAt: '2026-10-27T01:00:00.000Z' },
      }),
    );
  });
  it('renders loading and retryable load errors', () => {
    mocks.details = undefined;
    mocks.loading = true;
    const view = render(<AgentEditDialog agent={agent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }));
    expect(screen.getByText('Loading agent settings…')).toBeInTheDocument();
    mocks.loading = false;
    mocks.loadError = true;
    view.rerender(<AgentEditDialog agent={agent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.reload).toHaveBeenCalled();
  });
  it('keeps a draft mounted when a background reload fails', async () => {
    const view = render(<AgentEditDialog agent={agent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Retained draft name' } });
    mocks.loadError = true;
    mocks.reload.mockRejectedValue(new Error('Reload unavailable'));
    view.rerender(<AgentEditDialog agent={agent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved agent' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload unavailable');
    expect(screen.getByLabelText('Name')).toHaveValue('Retained draft name');
  });
  it('keeps provider failures visible and retryable', () => {
    mocks.providersError = true;
    openEdit();
    expect(screen.getByRole('button', { name: 'Save agent' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry providers' }));
    expect(mocks.retryProviders).toHaveBeenCalled();
  });
  it('rejects blank numeric limits rather than silently converting them to zero', async () => {
    openEdit();
    fireEvent.change(screen.getByLabelText('Cost limit (USD)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Complete each execution limit');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('prevents duplicate writes and hides controls from readers', () => {
    mocks.save.mockReturnValue(new Promise(() => {}));
    const view = render(<AgentEditDialog agent={agent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated name' } });
    const save = screen.getByRole('button', { name: 'Save agent' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    view.unmount();
    mocks.role = 'MEMBER';
    render(<AgentEditDialog />);
    expect(screen.queryByRole('button', { name: 'New agent' })).not.toBeInTheDocument();
  });
});
