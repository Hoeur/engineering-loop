import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { GitHubAppClient } from '../src';

const installation = { token: 'installation-token', expires_at: '2030-01-01T00:00:00Z' };
const repository = {
  id: 42,
  node_id: 'R_42',
  name: 'engloop',
  full_name: 'evalley/engloop',
  owner: { login: 'evalley' },
  private: true,
  archived: false,
  default_branch: 'main',
  language: 'TypeScript',
  html_url: 'https://github.com/evalley/engloop',
  clone_url: 'https://github.com/evalley/engloop.git',
};

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

const createClient = (fetcher: ReturnType<typeof vi.fn>) => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return new GitHubAppClient({
    appId: '123',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fetch: fetcher,
  });
};

describe('GitHubAppClient', () => {
  it('mints an installation token and lists normalized repositories', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(installation, 201))
      .mockResolvedValueOnce(response({ repositories: [repository] }));
    const repositories = await createClient(fetcher).listInstallationRepositories('99');
    expect(repositories).toEqual([
      expect.objectContaining({ id: '42', fullName: 'evalley/engloop', private: true }),
    ]);
    expect(fetcher.mock.calls[1]?.[1]?.headers.Authorization).toBe('Bearer installation-token');
  });

  it('lists every installation of the App with an App JWT', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      response([
        {
          id: 160,
          account: { id: 7, login: 'hoeur', type: 'User', avatar_url: null },
          repository_selection: 'all',
          target_type: 'User',
          permissions: { contents: 'write', metadata: 'read' },
          events: [],
          suspended_at: null,
        },
      ]),
    );
    const installations = await createClient(fetcher).listAppInstallations();
    expect(installations).toEqual([
      expect.objectContaining({ id: '160', account: expect.objectContaining({ login: 'hoeur' }) }),
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/app/installations?per_page=100&page=1',
    );
    // An App JWT has three dot-separated segments; an installation token does not.
    expect(fetcher.mock.calls[0]?.[1]?.headers.Authorization).toMatch(
      /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/,
    );
  });

  it('returns an existing pull request without creating a duplicate', async () => {
    const pull = {
      id: 10,
      number: 7,
      title: 'Task',
      body: '',
      state: 'open',
      draft: false,
      merged: false,
      html_url: 'https://github.com/evalley/engloop/pull/7',
      head: { ref: 'agent/task' },
      base: { ref: 'main' },
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(installation, 201))
      .mockResolvedValueOnce(response([pull]));
    const result = await createClient(fetcher).createOrFindPullRequest({
      installationId: '99',
      repositoryId: '42',
      owner: 'evalley',
      repo: 'engloop',
      head: 'evalley:agent/task',
      base: 'main',
      title: 'Task',
    });
    expect(result.created).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('paginates installations available to the authorizing user', async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      account: { id: index + 1, login: `owner-${index}`, type: 'User', avatar_url: null },
      repository_selection: 'all',
      target_type: 'User',
      permissions: {},
      events: [],
      suspended_at: null,
    }));
    const fetcher = vi.fn().mockResolvedValueOnce(response({ installations: page })).mockResolvedValueOnce(response({ installations: [] }));
    const installations = await createClient(fetcher).listUserInstallations('user-token');
    expect(installations).toHaveLength(100);
    expect(fetcher.mock.calls[1]?.[0]).toContain('page=2');
  });

  it('recovers when another request creates the pull request after the initial lookup', async () => {
    const pull = {
      id: 10,
      number: 7,
      title: 'Task',
      body: '',
      state: 'open',
      draft: false,
      merged: false,
      html_url: 'https://github.com/evalley/engloop/pull/7',
      head: { ref: 'agent/task' },
      base: { ref: 'main' },
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(installation, 201))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ message: 'Validation Failed' }, 422))
      .mockResolvedValueOnce(response([pull]));
    const result = await createClient(fetcher).createOrFindPullRequest({
      installationId: '99', repositoryId: '42', owner: 'evalley', repo: 'engloop',
      head: 'evalley:agent/task', base: 'main', title: 'Task',
    });
    expect(result).toEqual(expect.objectContaining({ number: 7, created: false }));
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
