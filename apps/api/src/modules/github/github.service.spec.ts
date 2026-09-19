import { generateKeyPairSync } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { createGitHubOAuthState } from '@engloop/github';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';
import type { AppConfigService } from '../../infrastructure/config/config.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { GitHubService } from './github.service';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  organizationId: 'org-1',
  role: 'OWNER',
};

const callbackUrl = 'http://localhost:3001/projects/github/callback';

const githubEnv = () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    GITHUB_APP_ID: '123',
    GITHUB_APP_SLUG: 'engloop-test',
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    GITHUB_APP_CLIENT_ID: 'client-id',
    GITHUB_APP_CLIENT_SECRET: 'client-secret',
    GITHUB_WEBHOOK_SECRET: 'w'.repeat(32),
    GITHUB_OAUTH_STATE_SECRET: 's'.repeat(32),
    GITHUB_OAUTH_CALLBACK_URL: callbackUrl,
    GITHUB_API_BASE_URL: 'https://api.github.com',
  };
};

const rawInstallation = (id: number, login = 'hoeur') => ({
  id,
  account: { id: 7, login, type: 'User', avatar_url: null },
  repository_selection: 'all',
  target_type: 'User',
  permissions: { contents: 'write', metadata: 'read' },
  events: [],
  suspended_at: null,
});

const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

/** Routes stubbed GitHub calls by method + path; anything unexpected fails the test. */
const stubGitHub = (routes: Record<string, unknown>) => {
  const fetcher = vi.fn(async (input: string, init?: { method?: string }) => {
    const url = new URL(input);
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    if (!(key in routes)) throw new Error(`Unexpected GitHub call: ${key}`);
    return json(routes[key]);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
};

const validState = () =>
  createGitHubOAuthState({
    organizationId: user.organizationId,
    userId: user.id,
    redirectUri: callbackUrl,
    secret: 's'.repeat(32),
  }).state;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitHubService authorization state', () => {
  it('stores a hash of each issued state rather than the bearer state itself', async () => {
    stubGitHub({ 'GET /app/installations': [] });
    const attemptCreate = vi.fn().mockResolvedValue({ id: 'attempt-1' });
    const prisma = {
      gitHubAuthorizationAttempt: { create: attemptCreate },
    } as unknown as PrismaService;
    const config = { env: githubEnv() } as unknown as AppConfigService;
    const service = new GitHubService(prisma, config, {
      recordSafe: vi.fn(),
    } as unknown as AuditService);

    const result = await service.startAuthorization(user);

    const stored = attemptCreate.mock.calls[0]?.[0]?.data.stateHash as string;
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toContain(result.state);
    expect(result.mode).toBe('install');
    expect(result.authorizationUrl).toContain('github.com/apps/engloop-test/installations/new');
  });

  it('sends an App that is already installed through the OAuth web flow', async () => {
    stubGitHub({ 'GET /app/installations': [rawInstallation(160)] });
    const prisma = {
      gitHubAuthorizationAttempt: { create: vi.fn().mockResolvedValue({ id: 'attempt-1' }) },
    } as unknown as PrismaService;
    const service = new GitHubService(
      prisma,
      { env: githubEnv() } as unknown as AppConfigService,
      { recordSafe: vi.fn() } as unknown as AuditService,
    );

    const result = await service.startAuthorization(user);

    const url = new URL(result.authorizationUrl);
    expect(result.mode).toBe('authorize');
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(callbackUrl);
    expect(url.searchParams.get('state')).toBe(result.state);
    expect(new URL(result.installUrl).searchParams.get('state')).toBe(result.state);
  });

  it('atomically rejects an already-consumed state before calling GitHub', async () => {
    const fetcher = stubGitHub({});
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = { gitHubAuthorizationAttempt: { updateMany } } as unknown as PrismaService;
    const service = new GitHubService(
      prisma,
      { env: githubEnv() } as unknown as AppConfigService,
      { recordSafe: vi.fn() } as unknown as AuditService,
    );

    const error = await service
      .completeAuthorization(user, {
        code: 'oauth-code',
        state: validState(),
        installationId: '42',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ consumedAt: null }) }),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('connects every installation the user can reach when GitHub sends no installation id', async () => {
    stubGitHub({
      'POST /login/oauth/access_token': { access_token: 'user-token', token_type: 'bearer' },
      'GET /user/installations': { installations: [rawInstallation(160)] },
      'GET /app/installations/160': rawInstallation(160),
    });
    const create = vi
      .fn()
      .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'record-1',
        ...data,
      }));
    const prisma = {
      gitHubAuthorizationAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      gitHubInstallation: { findUnique: vi.fn().mockResolvedValue(null), create },
    } as unknown as PrismaService;
    const service = new GitHubService(
      prisma,
      { env: githubEnv() } as unknown as AppConfigService,
      { recordSafe: vi.fn() } as unknown as AuditService,
    );

    const result = await service.completeAuthorization(user, {
      code: 'oauth-code',
      state: validState(),
    });

    expect(result.installations).toHaveLength(1);
    expect(result.installation).toEqual(
      expect.objectContaining({ installationId: '160', accountLogin: 'hoeur' }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ externalId: '160' }) }),
    );
  });

  it('explains how to install the App when the user can reach no installation', async () => {
    stubGitHub({
      'POST /login/oauth/access_token': { access_token: 'user-token', token_type: 'bearer' },
      'GET /user/installations': { installations: [] },
    });
    const prisma = {
      gitHubAuthorizationAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as PrismaService;
    const service = new GitHubService(
      prisma,
      { env: githubEnv() } as unknown as AppConfigService,
      { recordSafe: vi.fn() } as unknown as AuditService,
    );

    const error = await service
      .completeAuthorization(user, { code: 'oauth-code', state: validState() })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('GITHUB_INSTALLATION_REQUIRED');
    expect((error as AppError).getStatus()).toBe(HttpStatus.CONFLICT);
    expect((error as AppError).details).toEqual({
      installUrl: 'https://github.com/apps/engloop-test/installations/new',
    });
  });
});
