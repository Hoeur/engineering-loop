import type * as React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentRole, OrgRole } from '@engloop/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPrompts } from './project-prompts';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), role: 'OWNER' }));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<object>()),
  api: { get: mocks.get, post: mocks.post },
}));
vi.mock('@/lib/queries', () => ({
  useCurrentUser: () => ({ data: { role: mocks.role } }),
  useBoard: () => ({
    data: {
      items: [
        { id: 'task-one', key: 'T-1', title: 'First task' },
        { id: 'task-two', key: 'T-2', title: 'Second task' },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
const template = {
  id: 'prompt-one',
  name: 'Plan work',
  role: AgentRole.PLANNER,
  currentRevision: 2,
  createdAt: '',
};
let client: QueryClient;
function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectPrompts projectId="project-one" />
    </QueryClientProvider>,
  );
}
async function open() {
  fireEvent.click(await screen.findByRole('button', { name: /Plan work.*revision 2/ }));
  await screen.findByText('Viewing saved revision 2. New revisions preserve this text.');
}
beforeEach(() => {
  mocks.role = OrgRole.OWNER;
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.get.mockImplementation(async (path: string) => ({
    data: path.endsWith('/prompts')
      ? [template]
      : {
          id: 'revision',
          templateId: template.id,
          revision: Number(path.split('/').at(-1)),
          body: 'Plan {{task.title}}',
          template,
        },
  }));
});
afterEach(() => client?.clear());

describe('Project prompts', () => {
  it('renders loading, empty and retryable error states', async () => {
    mocks.get.mockReturnValueOnce(new Promise(() => {}));
    const view = mount();
    expect(screen.getByText('Loading project prompts…')).toBeInTheDocument();
    view.unmount();
    client.clear();
    mocks.get.mockResolvedValueOnce({ data: [] });
    const empty = mount();
    expect(await screen.findByText('No project prompts yet.')).toBeInTheDocument();
    empty.unmount();
    client.clear();
    mocks.get.mockRejectedValueOnce(new Error('Offline'));
    mount();
    expect(await screen.findByText('UNKNOWN: Offline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('validates shared placeholders and creates a role prompt', async () => {
    mocks.get.mockResolvedValue({ data: [] });
    mocks.post.mockResolvedValue({ data: template });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'New prompt' }));
    fireEvent.change(screen.getByLabelText('Prompt name'), { target: { value: 'My plan' } });
    fireEvent.change(screen.getByLabelText('Prompt role'), {
      target: { value: AgentRole.PLANNER },
    });
    fireEvent.change(screen.getByLabelText('Prompt body'), {
      target: { value: '{{credentials}}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create prompt' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Unsupported prompt variable');
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Prompt body'), {
      target: { value: 'Plan {{task.title}}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create prompt' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/projects/project-one/prompts', {
        name: 'My plan',
        role: AgentRole.PLANNER,
        body: 'Plan {{task.title}}',
      }),
    );
  });

  it('preserves the edit baseline and draft after a concurrent revision conflict', async () => {
    mocks.post.mockRejectedValue(new Error('Prompt revision changed; reload before revising it'));
    mount();
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Edit as new revision' }));
    fireEvent.change(screen.getByLabelText('Prompt body'), { target: { value: 'Keep my draft' } });
    mocks.get.mockResolvedValueOnce({ data: [{ ...template, currentRevision: 3 }] });
    fireEvent.click(screen.getByRole('button', { name: 'Reload prompts' }));
    await screen.findByText('Revision (latest: 3)');
    fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/projects/project-one/prompts/prompt-one/revisions',
        { expectedRevision: 2, body: 'Keep my draft' },
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is retained');
    expect(screen.getByLabelText('Prompt body')).toHaveValue('Keep my draft');
  });

  it('reads historical text without offering to edit it', async () => {
    mount();
    await open();
    fireEvent.change(screen.getByLabelText(/Revision \(latest/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'View revision' }));
    await screen.findByText('Viewing saved revision 1. New revisions preserve this text.');
    expect(mocks.get).toHaveBeenCalledWith('/projects/project-one/prompts/prompt-one/revisions/1');
    expect(screen.queryByRole('button', { name: 'Edit as new revision' })).not.toBeInTheDocument();
  });

  it('allows a reader to validate saved output and discards responses from another revision', async () => {
    mocks.role = OrgRole.MEMBER;
    let finish: (value: unknown) => void = () => {};
    mocks.post.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    await open();
    fireEvent.change(screen.getByLabelText('Output JSON'), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate output' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/projects/project-one/prompts/prompt-one/revisions/2/validate-output',
        { output: {} },
      ),
    );
    fireEvent.change(screen.getByLabelText(/Revision \(latest/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'View revision' }));
    await screen.findByText('Viewing saved revision 1. New revisions preserve this text.');
    await act(async () => finish({ data: { valid: true, revision: 2, role: AgentRole.PLANNER } }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Output JSON')).toHaveValue('');
  });

  it('keeps members read-only while allowing saved preview and ignores late results for another task', async () => {
    mocks.role = OrgRole.MEMBER;
    let finish: (value: unknown) => void = () => {};
    mocks.post.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    await open();
    expect(screen.queryByRole('button', { name: 'New prompt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit as new revision' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Preview task'), { target: { value: 'task-one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview saved revision' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/projects/project-one/prompts/prompt-one/revisions/2/preview',
        { taskId: 'task-one' },
      ),
    );
    fireEvent.change(screen.getByLabelText('Preview task'), { target: { value: 'task-two' } });
    await act(async () =>
      finish({ data: { revision: 2, role: AgentRole.PLANNER, body: 'Old task result' } }),
    );
    expect(screen.queryByText('Old task result')).not.toBeInTheDocument();
    mocks.post.mockResolvedValue({
      data: { revision: 2, role: AgentRole.PLANNER, body: '<script>literal task text</script>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview saved revision' }));
    const result = await screen.findByLabelText('Rendered prompt');
    expect(within(result).getByText('<script>literal task text</script>')).toBeInTheDocument();
    expect(result.querySelector('script')).toBeNull();
  });
});
