import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubProjectActions } from './github-project-actions';

const mocks = vi.hoisted(() => ({
  installations: vi.fn(),
  repositories: vi.fn(),
  start: vi.fn(),
  importRepository: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/queries', () => ({
  useGitHubInstallations: mocks.installations,
  useGitHubRepositories: mocks.repositories,
  useStartGitHubAuthorization: mocks.start,
  useImportGitHubRepository: mocks.importRepository,
}));

const idleMutation = {
  isPending: false,
  isError: false,
  error: null,
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
};

describe('GitHubProjectActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repositories.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mocks.start.mockReturnValue({ ...idleMutation });
    mocks.importRepository.mockReturnValue({ ...idleMutation });
  });

  it('offers a GitHub connection when the organization has no installation', () => {
    mocks.installations.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<GitHubProjectActions />);

    expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeEnabled();
  });

  it('offers repository import when an installation is connected', () => {
    mocks.installations.mockReturnValue({
      data: {
        items: [
          {
            id: 'connection-1',
            installationId: '123',
            accountLogin: 'evalley',
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<GitHubProjectActions />);

    expect(screen.getByRole('button', { name: 'Import from GitHub' })).toBeEnabled();
  });
});
