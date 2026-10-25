import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentRole } from '@engloop/types';
import { PROMPT_OUTPUT_MAX_CHARS } from '@engloop/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { PromptOutputValidation } from './prompt-output-validation';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<object>()),
  api: { post: mocks.post },
}));
let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PromptOutputValidation
        projectId="project-one"
        templateId="template-one"
        revision={2}
        role={AgentRole.DOCUMENTATION}
      />
    </QueryClientProvider>,
  );
}
const edit = (value: string) =>
  fireEvent.change(screen.getByLabelText('Output JSON'), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Validate output' }));
const result = {
  valid: true,
  templateId: 'template-one',
  revision: 2,
  role: AgentRole.DOCUMENTATION,
};
beforeEach(() => {
  mocks.post.mockReset();
  mocks.post.mockResolvedValue({ data: result });
});
afterEach(() => client?.clear());

describe('Prompt output validation', () => {
  it('rejects empty, malformed and oversized JSON locally without losing the input', () => {
    mount();
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter JSON');
    edit('{');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON');
    expect(screen.getByLabelText('Output JSON')).toHaveValue('{');
    const oversized = JSON.stringify({ summary: 'x'.repeat(PROMPT_OUTPUT_MAX_CHARS) });
    edit(oversized);
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('200,000');
    expect(screen.getByLabelText('Output JSON')).toHaveValue(oversized);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('posts parsed JSON to the exact revision and clears success when the input changes', async () => {
    mount();
    edit('{"summary":"<script>literal</script>"}');
    submit();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'DOCUMENTATION contract for saved revision 2',
    );
    expect(mocks.post).toHaveBeenCalledWith(
      '/projects/project-one/prompts/template-one/revisions/2/validate-output',
      {
        output: { summary: '<script>literal</script>' },
      },
    );
    expect(screen.getByText(/does not run an agent or accept work/)).toBeVisible();
    edit('{}');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });

  it('shows safe server field errors, retains JSON and supports retry after API failures', async () => {
    mocks.post.mockRejectedValueOnce(
      new ApiError('VALIDATION_FAILED', 'Output does not satisfy the prompt role contract', 422, {
        issues: [{ path: ['documents', '0', 'path'], message: 'Required' }],
      }),
    );
    mount();
    edit('{"documents":[{}]}');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('documents.0.path: Required');
    expect(screen.getByLabelText('Output JSON')).toHaveValue('{"documents":[{}]}');
    mocks.post.mockRejectedValueOnce(new ApiError('CONNECTION_FAILED', 'Offline', 0));
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    submit();
    await screen.findByRole('status');
    expect(mocks.post).toHaveBeenCalledTimes(3);
  });

  it('blocks duplicate submissions and ignores an old response after editing JSON', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.post.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    edit('{"summary":"Old"}');
    submit();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Validating output…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Validating output…' }));
    edit('{"summary":"New"}');
    await act(async () => finish({ data: result }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Output JSON')).toHaveValue('{"summary":"New"}');
    submit();
    await screen.findByRole('status');
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });
});
