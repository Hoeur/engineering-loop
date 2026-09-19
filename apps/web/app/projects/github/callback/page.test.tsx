import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import GitHubCallbackPage from './page';

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  complete: vi.fn(),
  start: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.params,
}));
vi.mock('@/lib/queries', () => ({
  useCompleteGitHubAuthorization: () => ({ mutateAsync: mocks.complete }),
  useStartGitHubAuthorization: () => ({ mutateAsync: mocks.start }),
}));

const state = 's'.repeat(40);

describe('GitHub callback page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes a state-bound authorization and returns to projects', async () => {
    mocks.params = new URLSearchParams({ code: 'oauth-code', state });
    mocks.complete.mockResolvedValue({ installations: [] });

    render(<GitHubCallbackPage />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/projects?github=connected'));
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.complete).toHaveBeenCalledWith({
      state,
      code: 'oauth-code',
      installationId: undefined,
      setupAction: undefined,
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('never uses a code that arrives without state and restarts a bound authorization', async () => {
    mocks.params = new URLSearchParams({
      code: 'unbound-code',
      installation_id: '160',
      setup_action: 'install',
    });
    // A hash-only URL keeps jsdom from attempting a real navigation.
    mocks.start.mockResolvedValue({ authorizationUrl: '#github-authorize' });

    render(<GitHubCallbackPage />);

    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('offers the GitHub install page when no installation is reachable', async () => {
    mocks.params = new URLSearchParams({ code: 'oauth-code', state });
    mocks.complete.mockRejectedValue(
      new ApiError('GITHUB_INSTALLATION_REQUIRED', 'Install the App first.', 409, {
        installUrl: 'https://github.com/apps/engineering-loop/installations/new',
      }),
    );

    render(<GitHubCallbackPage />);

    expect(await screen.findByText('Install the App first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install on GitHub' })).toBeEnabled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
