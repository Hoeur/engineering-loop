export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  clientId?: string;
  clientSecret?: string;
  apiBaseUrl?: string;
  requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface GitHubInstallation {
  id: string;
  account: {
    id: string;
    login: string;
    type: string;
    avatarUrl: string | null;
  };
  repositorySelection: string;
  targetType: string;
  permissions: Record<string, string>;
  events: string[];
  suspendedAt: string | null;
}

export interface GitHubRepository {
  id: string;
  nodeId: string;
  name: string;
  fullName: string;
  description: string | null;
  owner: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
  language: string | null;
  htmlUrl: string;
  cloneUrl: string;
  visibility: string;
  pushedAt: string | null;
}

export interface GitHubPullRequest {
  id: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  htmlUrl: string;
  head: string;
  base: string;
  created: boolean;
}

export interface CreateOrFindPullRequestInput {
  installationId: string;
  repositoryId: string;
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body?: string;
  draft?: boolean;
}

export interface InstallationTokenOptions {
  repositoryIds?: string[];
  permissions?: Record<string, string>;
}

export interface GitHubOAuthStatePayload {
  organizationId: string;
  userId: string;
  redirectUri: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}
