import { createGitHubAppJwt } from './auth';
import type {
  CreateOrFindPullRequestInput,
  GitHubAppConfig,
  GitHubInstallation,
  GitHubPullRequest,
  GitHubRepository,
  InstallationTokenOptions,
} from './types';

interface RawResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<RawResponse>;

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(`GitHub API ${status} for ${path}: ${message}`);
    this.name = 'GitHubApiError';
  }
}

export class GitHubAppClient {
  private readonly apiBaseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly requestTimeoutMs: number;

  constructor(private readonly config: GitHubAppConfig) {
    this.apiBaseUrl = (config.apiBaseUrl ?? 'https://api.github.com').replace(/\/$/, '');
    this.fetcher = (config.fetch ?? globalThis.fetch) as FetchLike;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 15_000;
  }

  async getInstallation(installationId: string): Promise<GitHubInstallation> {
    const raw = await this.request<Record<string, unknown>>(
      `/app/installations/${encodeURIComponent(installationId)}`,
      this.appAuthorization(),
    );
    return normalizeInstallation(raw);
  }

  async createInstallationAccessToken(
    installationId: string,
    options: InstallationTokenOptions = {},
  ): Promise<{ token: string; expiresAt: string }> {
    const raw = await this.request<Record<string, unknown>>(
      `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      this.appAuthorization(),
      {
        method: 'POST',
        body: JSON.stringify({
          ...(options.repositoryIds
            ? {
                repository_ids: options.repositoryIds.map((id) => {
                  const numericId = Number(id);
                  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
                    throw new GitHubApiError(400, 'installation token', 'Invalid repository id');
                  }
                  return numericId;
                }),
              }
            : {}),
          ...(options.permissions ? { permissions: options.permissions } : {}),
        }),
      },
    );
    if (typeof raw.token !== 'string' || typeof raw.expires_at !== 'string') {
      throw new GitHubApiError(502, 'installation token', 'Malformed response');
    }
    return { token: raw.token, expiresAt: raw.expires_at };
  }

  async exchangeOAuthCode(
    code: string,
    redirectUri?: string,
  ): Promise<{ token: string; tokenType: string; scope: string }> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new GitHubApiError(
        500,
        'oauth/token',
        'GitHub OAuth client credentials are not configured',
      );
    }
    const response = await this.fetchWithTimeout('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      }),
    }, 'oauth/token');
    const text = await response.text();
    const raw = parseJsonRecord(text, 'oauth/token');
    if (!response.ok || typeof raw.access_token !== 'string') {
      const message =
        typeof raw.error_description === 'string'
          ? raw.error_description
          : 'OAuth code exchange failed';
      throw new GitHubApiError(response.status, 'oauth/token', message);
    }
    return {
      token: raw.access_token,
      tokenType: typeof raw.token_type === 'string' ? raw.token_type : 'bearer',
      scope: typeof raw.scope === 'string' ? raw.scope : '',
    };
  }

  /** Every installation of this App, across all accounts (authenticated as the App). */
  async listAppInstallations(): Promise<GitHubInstallation[]> {
    const installations: GitHubInstallation[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const raw = await this.request<unknown>(
        `/app/installations?per_page=100&page=${page}`,
        this.appAuthorization(),
      );
      const pageItems = Array.isArray(raw) ? raw : [];
      installations.push(
        ...pageItems.map((value) => normalizeInstallation(asRecord(value, 'installation'))),
      );
      if (pageItems.length < 100) break;
    }
    return installations;
  }

  async listUserInstallations(userToken: string): Promise<GitHubInstallation[]> {
    const installations: GitHubInstallation[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const raw = await this.request<Record<string, unknown>>(
        `/user/installations?per_page=100&page=${page}`,
        `Bearer ${userToken}`,
      );
      const pageItems = Array.isArray(raw.installations) ? raw.installations : [];
      installations.push(
        ...pageItems.map((value) => normalizeInstallation(asRecord(value, 'installation'))),
      );
      if (pageItems.length < 100) break;
    }
    return installations;
  }

  async listInstallationRepositories(installationId: string): Promise<GitHubRepository[]> {
    const authorization = await this.installationAuthorization(installationId);
    const repositories: GitHubRepository[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const raw = await this.request<Record<string, unknown>>(
        `/installation/repositories?per_page=100&page=${page}`,
        authorization,
      );
      const pageItems = Array.isArray(raw.repositories) ? raw.repositories : [];
      repositories.push(...pageItems.map(normalizeRepository));
      if (pageItems.length < 100) break;
    }
    return repositories;
  }

  async getRepository(
    installationId: string,
    owner: string,
    repo: string,
  ): Promise<GitHubRepository> {
    const raw = await this.request<Record<string, unknown>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      await this.installationAuthorization(installationId),
    );
    return normalizeRepository(raw);
  }

  async createOrFindPullRequest(input: CreateOrFindPullRequestInput): Promise<GitHubPullRequest> {
    const access = await this.createInstallationAccessToken(input.installationId, {
      repositoryIds: [input.repositoryId],
      permissions: { contents: 'read', pull_requests: 'write' },
    });
    const authorization = `Bearer ${access.token}`;
    const repoPath = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
    const existing = await this.request<unknown[]>(
      `${repoPath}/pulls?state=open&head=${encodeURIComponent(input.head)}&base=${encodeURIComponent(input.base)}&per_page=1`,
      authorization,
    );
    const first = existing[0];
    if (first && typeof first === 'object') return normalizePullRequest(first, false);

    try {
      const created = await this.request<Record<string, unknown>>(
        `${repoPath}/pulls`,
        authorization,
        {
          method: 'POST',
          body: JSON.stringify({
            title: input.title,
            head: input.head,
            base: input.base,
            body: input.body ?? '',
            draft: input.draft ?? false,
          }),
        },
      );
      return normalizePullRequest(created, true);
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 422) throw error;
      const raced = await this.request<unknown[]>(
        `${repoPath}/pulls?state=open&head=${encodeURIComponent(input.head)}&base=${encodeURIComponent(input.base)}&per_page=1`,
        authorization,
      );
      const duplicate = raced[0];
      if (!duplicate || typeof duplicate !== 'object') throw error;
      return normalizePullRequest(duplicate, false);
    }
  }

  private appAuthorization(): string {
    return `Bearer ${createGitHubAppJwt({ appId: this.config.appId, privateKey: this.config.privateKey })}`;
  }

  private async installationAuthorization(installationId: string): Promise<string> {
    const access = await this.createInstallationAccessToken(installationId);
    return `Bearer ${access.token}`;
  }

  private async request<T>(
    path: string,
    authorization: string,
    init: { method?: string; body?: string } = {},
  ): Promise<T> {
    const response = await this.fetchWithTimeout(`${this.apiBaseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: authorization,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: init.body } : {}),
    }, path);
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        if (response.ok) throw new GitHubApiError(502, path, 'Malformed JSON response');
      }
    }
    if (!response.ok) {
      const message =
        body &&
        typeof body === 'object' &&
        typeof (body as Record<string, unknown>).message === 'string'
          ? String((body as Record<string, unknown>).message)
          : 'Request failed';
      throw new GitHubApiError(response.status, path, message);
    }
    return body as T;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    path: string,
  ): Promise<RawResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetcher(url, { ...init, signal: controller.signal });
    } catch {
      if (controller.signal.aborted) {
        throw new GitHubApiError(504, path, 'Request timed out');
      }
      throw new GitHubApiError(503, path, 'Network request failed');
    } finally {
      clearTimeout(timer);
    }
  }
}

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object')
    throw new GitHubApiError(502, label, 'Malformed response');
  return value as Record<string, unknown>;
};

const parseJsonRecord = (text: string, label: string): Record<string, unknown> => {
  try {
    return asRecord(JSON.parse(text), label);
  } catch (error) {
    if (error instanceof GitHubApiError) throw error;
    throw new GitHubApiError(502, label, 'Malformed JSON response');
  }
};

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value)
    throw new GitHubApiError(502, label, 'Malformed response');
  return value;
};

const requiredId = (value: unknown, label: string): string => {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new GitHubApiError(502, label, 'Malformed response');
  }
  return String(value);
};

const normalizeInstallation = (raw: Record<string, unknown>): GitHubInstallation => {
  const account = asRecord(raw.account, 'installation.account');
  return {
    id: requiredId(raw.id, 'installation.id'),
    account: {
      id: requiredId(account.id, 'installation.account.id'),
      login: requiredString(account.login, 'installation.account.login'),
      type: requiredString(account.type, 'installation.account.type'),
      avatarUrl: typeof account.avatar_url === 'string' ? account.avatar_url : null,
    },
    repositorySelection:
      typeof raw.repository_selection === 'string' ? raw.repository_selection : 'selected',
    targetType: typeof raw.target_type === 'string' ? raw.target_type : 'Organization',
    permissions: asStringRecord(raw.permissions),
    events: Array.isArray(raw.events)
      ? raw.events.filter((v): v is string => typeof v === 'string')
      : [],
    suspendedAt: typeof raw.suspended_at === 'string' ? raw.suspended_at : null,
  };
};

const normalizeRepository = (value: unknown): GitHubRepository => {
  const raw = asRecord(value, 'repository');
  const owner = asRecord(raw.owner, 'repository.owner');
  return {
    id: requiredId(raw.id, 'repository.id'),
    nodeId: requiredString(raw.node_id, 'repository.node_id'),
    name: requiredString(raw.name, 'repository.name'),
    fullName: requiredString(raw.full_name, 'repository.full_name'),
    description: typeof raw.description === 'string' ? raw.description : null,
    owner: requiredString(owner.login, 'repository.owner.login'),
    private: raw.private === true,
    archived: raw.archived === true,
    defaultBranch: requiredString(raw.default_branch, 'repository.default_branch'),
    language: typeof raw.language === 'string' ? raw.language : null,
    htmlUrl: requiredString(raw.html_url, 'repository.html_url'),
    cloneUrl: requiredString(raw.clone_url, 'repository.clone_url'),
    visibility: typeof raw.visibility === 'string' ? raw.visibility : raw.private === true ? 'private' : 'public',
    pushedAt: typeof raw.pushed_at === 'string' ? raw.pushed_at : null,
  };
};

const normalizePullRequest = (value: unknown, created: boolean): GitHubPullRequest => {
  const raw = asRecord(value, 'pull_request');
  const head = asRecord(raw.head, 'pull_request.head');
  const base = asRecord(raw.base, 'pull_request.base');
  const state = raw.state === 'closed' ? 'closed' : 'open';
  return {
    id: requiredId(raw.id, 'pull_request.id'),
    number: Number(raw.number),
    title: requiredString(raw.title, 'pull_request.title'),
    body: typeof raw.body === 'string' ? raw.body : '',
    state,
    draft: raw.draft === true,
    merged: raw.merged === true || typeof raw.merged_at === 'string',
    htmlUrl: requiredString(raw.html_url, 'pull_request.html_url'),
    head: requiredString(head.ref, 'pull_request.head.ref'),
    base: requiredString(base.ref, 'pull_request.base.ref'),
    created,
  };
};

const asStringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
};
