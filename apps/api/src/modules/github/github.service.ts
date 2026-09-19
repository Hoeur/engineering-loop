import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  GitHubApiError,
  GitHubAppClient,
  createGitHubOAuthState,
  verifyGitHubOAuthState,
} from '@engloop/github';
import type { GitHubInstallation, GitHubRepository } from '@engloop/github';
import type { GitHubAuthorizationCompleteDto, GitHubImportRepositoryDto } from '@engloop/schemas';
import { AuditAction, OrgRole, PermissionLevel, RepositoryProvider } from '@engloop/types';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';
import { AppConfigService } from '../../infrastructure/config/config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const MANAGER_ROLES = new Set<string>([OrgRole.OWNER, OrgRole.ADMIN]);

@Injectable()
export class GitHubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  async startAuthorization(user: AuthenticatedUser) {
    this.assertManager(user.role);
    const github = this.requireConfig();
    // An App that is already installed cannot be installed again: GitHub opens the
    // installation's settings page instead and never redirects back here. Those
    // users go through the OAuth web flow, which always returns to the callback with
    // a code (immediately, for a user who has authorized the App before).
    let alreadyInstalled: boolean;
    try {
      alreadyInstalled = (await this.client(github).listAppInstallations()).length > 0;
    } catch (error) {
      this.rethrowGitHub(error);
    }
    const signed = createGitHubOAuthState({
      organizationId: user.organizationId,
      userId: user.id,
      redirectUri: github.callbackUrl,
      secret: github.stateSecret,
    });
    const installUrl = new URL(
      `https://github.com/apps/${encodeURIComponent(github.slug)}/installations/new`,
    );
    installUrl.searchParams.set('state', signed.state);
    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', github.clientId);
    authorizeUrl.searchParams.set('redirect_uri', github.callbackUrl);
    authorizeUrl.searchParams.set('state', signed.state);
    await this.prisma.gitHubAuthorizationAttempt.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        stateHash: hashState(signed.state),
        expiresAt: new Date(signed.expiresAt),
      },
    });
    return {
      authorizationUrl: (alreadyInstalled ? authorizeUrl : installUrl).toString(),
      mode: alreadyInstalled ? ('authorize' as const) : ('install' as const),
      // Same state, so either link completes this attempt — e.g. to add another account.
      installUrl: installUrl.toString(),
      state: signed.state,
      expiresAt: signed.expiresAt,
      callbackUrl: github.callbackUrl,
    };
  }

  async completeAuthorization(user: AuthenticatedUser, dto: GitHubAuthorizationCompleteDto) {
    this.assertManager(user.role);
    const github = this.requireConfig();
    let state;
    try {
      state = verifyGitHubOAuthState({ state: dto.state, secret: github.stateSecret });
    } catch {
      throw AppError.unauthorized('Invalid or expired GitHub authorization state');
    }
    if (state.organizationId !== user.organizationId || state.userId !== user.id) {
      throw AppError.forbidden('GitHub authorization state does not belong to this session');
    }
    const consumed = await this.prisma.gitHubAuthorizationAttempt.updateMany({
      where: {
        organizationId: user.organizationId,
        userId: user.id,
        stateHash: hashState(dto.state),
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw AppError.unauthorized(
        'GitHub authorization state was already used or was not issued by this server',
      );
    }

    const client = this.client(github);
    try {
      const oauth = await client.exchangeOAuthCode(dto.code, state.redirectUri);
      const accessible = await client.listUserInstallations(oauth.token);
      // With an installation id (fresh install) connect exactly that one; without one
      // (the App was already installed) connect every installation this user can reach.
      const requested = dto.installationId
        ? accessible.filter((item) => item.id === dto.installationId)
        : accessible;
      if (dto.installationId && requested.length === 0) {
        throw AppError.forbidden('The signed-in GitHub user cannot access this installation');
      }
      if (requested.length === 0) {
        throw AppError.conflict(
          'GITHUB_INSTALLATION_REQUIRED',
          `Your GitHub account cannot reach any installation of the ${github.slug} App yet. Install it on your account or organization, then connect again.`,
          {
            installUrl: `https://github.com/apps/${encodeURIComponent(github.slug)}/installations/new`,
          },
        );
      }

      const connected: Awaited<ReturnType<GitHubService['persistInstallation']>>[] = [];
      let skipped: AppError | undefined;
      for (const userInstallation of requested) {
        const installation = await client.getInstallation(userInstallation.id);
        if (
          installation.id !== userInstallation.id ||
          installation.account.id !== userInstallation.account.id
        ) {
          throw AppError.forbidden('GitHub installation ownership verification failed');
        }
        try {
          connected.push(await this.persistInstallation(user, installation));
        } catch (error) {
          // Connecting "everything reachable" must not fail because one installation
          // already belongs to another EngLoop organization; an explicit request must.
          if (
            !dto.installationId &&
            error instanceof AppError &&
            error.code === 'GITHUB_INSTALLATION_ALREADY_CONNECTED'
          ) {
            skipped = error;
            continue;
          }
          throw error;
        }
      }
      if (connected.length === 0 && skipped) throw skipped;

      const installations = connected.map(({ externalId, ...fields }) => ({
        ...fields,
        installationId: externalId,
      }));
      return {
        installation: installations[0],
        installations,
        redirectUri: state.redirectUri,
      };
    } catch (error) {
      this.rethrowGitHub(error);
    }
  }

  async listInstallations(organizationId: string) {
    this.requireConfig();
    const items = await this.prisma.gitHubInstallation.findMany({
      where: { organizationId },
      orderBy: { accountLogin: 'asc' },
      select: {
        id: true,
        externalId: true,
        accountId: true,
        accountLogin: true,
        accountType: true,
        accountAvatarUrl: true,
        repositorySelection: true,
        targetType: true,
        permissions: true,
        events: true,
        suspendedAt: true,
        lastSyncedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { repositories: true } },
      },
    });
    return {
      items: items.map(({ externalId, ...item }) => ({
        ...item,
        installationId: externalId,
        status: item.suspendedAt ? 'SUSPENDED' : 'CONNECTED',
      })),
      meta: {},
    };
  }

  async listRepositories(organizationId: string, installationId: string) {
    const installation = await this.requireInstallation(organizationId, installationId);
    try {
      const remoteItems = await this.client(this.requireConfig()).listInstallationRepositories(
        installationId,
      );
      const imported = await this.prisma.repository.findMany({
        where: { githubInstallationRecordId: installation.id },
        select: { id: true, projectId: true, githubRepositoryId: true },
      });
      const importedById = new Map(
        imported
          .filter((item) => item.githubRepositoryId)
          .map((item) => [item.githubRepositoryId, item]),
      );
      const items = remoteItems.map((item) => {
        const local = importedById.get(item.id);
        return {
          ...item,
          imported: Boolean(local),
          repositoryId: local?.id ?? null,
          projectId: local?.projectId ?? null,
        };
      });
      await this.prisma.gitHubInstallation.update({
        where: { id: installation.id },
        data: { lastSyncedAt: new Date() },
      });
      return { items, meta: {} };
    } catch (error) {
      this.rethrowGitHub(error);
    }
  }

  async importRepository(user: AuthenticatedUser, dto: GitHubImportRepositoryDto) {
    this.assertManager(user.role);
    const installation = await this.requireInstallation(user.organizationId, dto.installationId);
    let remote: GitHubRepository;
    try {
      const repositories = await this.client(this.requireConfig()).listInstallationRepositories(
        dto.installationId,
      );
      const found = repositories.find((repository) => repository.id === dto.repositoryId);
      if (!found) throw AppError.notFound('GitHub repository', dto.repositoryId);
      remote = found;
    } catch (error) {
      this.rethrowGitHub(error);
    }

    const existing = await this.prisma.repository.findFirst({
      where: {
        githubInstallationRecordId: installation.id,
        githubRepositoryId: remote.id,
        project: { organizationId: user.organizationId },
      },
      include: { project: true },
    });
    if (existing) return { project: existing.project, repository: existing, created: false };

    const slug = await this.uniqueSlug(
      user.organizationId,
      dto.projectSlug ?? slugify(remote.name),
    );
    const key = await this.uniqueKey(
      user.organizationId,
      dto.projectKey ?? keyFromName(remote.name),
    );
    let result;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.create({
        data: {
          organizationId: user.organizationId,
          name: dto.projectName ?? remote.name,
          slug,
          key,
          description: `Imported from ${remote.fullName}`,
          permissionLevel: PermissionLevel.LEVEL_3_PR,
        },
      });
        const repository = await tx.repository.create({
        data: {
          projectId: project.id,
          name: remote.name,
          provider: RepositoryProvider.GITHUB,
          remoteUrl: remote.cloneUrl,
          defaultBranch: remote.defaultBranch,
          primaryLanguage: remote.language,
          installationId: dto.installationId,
          githubInstallationRecordId: installation.id,
          githubRepositoryId: remote.id,
          githubNodeId: remote.nodeId,
          githubOwner: remote.owner,
          githubFullName: remote.fullName,
          githubPrivate: remote.private,
          githubArchived: remote.archived,
          githubHtmlUrl: remote.htmlUrl,
          lastSyncedAt: new Date(),
        },
      });
        return { project, repository, created: true };
      });
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const raced = await this.prisma.repository.findFirst({
        where: {
          githubInstallationRecordId: installation.id,
          githubRepositoryId: remote.id,
          project: { organizationId: user.organizationId },
        },
        include: { project: true },
      });
      if (!raced) {
        throw AppError.conflict(
          'GITHUB_IMPORT_CONFLICT',
          'The repository import conflicted with another project change; retry the import',
        );
      }
      return { project: raced.project, repository: raced, created: false };
    }

    await this.audit.recordSafe({
      organizationId: user.organizationId,
      projectId: result.project.id,
      userId: user.id,
      action: AuditAction.CONFIGURATION_CHANGED,
      entityType: 'github.repository',
      entityId: result.repository.id,
      summary: `Imported GitHub repository ${remote.fullName}`,
      metadata: { installationId: dto.installationId, githubRepositoryId: remote.id },
    });
    return result;
  }

  private async persistInstallation(user: AuthenticatedUser, installation: GitHubInstallation) {
    let existing = await this.prisma.gitHubInstallation.findUnique({
      where: { externalId: installation.id },
    });
    if (existing && existing.organizationId !== user.organizationId) {
      throw AppError.conflict(
        'GITHUB_INSTALLATION_ALREADY_CONNECTED',
        'This GitHub installation is connected to another organization',
      );
    }
    let saved;
    if (!existing) {
      try {
        saved = await this.prisma.gitHubInstallation.create({
          data: installationData(user, installation),
        });
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        existing = await this.prisma.gitHubInstallation.findUnique({
          where: { externalId: installation.id },
        });
        if (!existing || existing.organizationId !== user.organizationId) {
          throw AppError.conflict(
            'GITHUB_INSTALLATION_ALREADY_CONNECTED',
            'This GitHub installation is connected to another organization',
          );
        }
      }
    }
    if (!saved) {
      if (!existing) throw AppError.internal('GitHub installation persistence failed');
      saved = await this.prisma.gitHubInstallation.update({
        where: { id: existing.id },
        data: {
        accountId: installation.account.id,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        accountAvatarUrl: installation.account.avatarUrl,
        repositorySelection: installation.repositorySelection,
        targetType: installation.targetType,
        permissions: installation.permissions,
        events: installation.events,
        suspendedAt: installation.suspendedAt ? new Date(installation.suspendedAt) : null,
        },
      });
    }
    await this.audit.recordSafe({
      organizationId: user.organizationId,
      userId: user.id,
      action: AuditAction.CONFIGURATION_CHANGED,
      entityType: 'github.installation',
      entityId: saved.id,
      summary: `Connected GitHub installation for ${saved.accountLogin}`,
      metadata: { installationId: saved.externalId },
    });
    return saved;
  }

  private async requireInstallation(organizationId: string, externalId: string) {
    const installation = await this.prisma.gitHubInstallation.findFirst({
      where: { organizationId, externalId },
    });
    if (!installation) throw AppError.notFound('GitHub installation', externalId);
    if (installation.suspendedAt)
      throw AppError.conflict('GITHUB_INSTALLATION_SUSPENDED', 'GitHub installation is suspended');
    return installation;
  }

  private requireConfig() {
    const env = this.config.env;
    if (
      !env.GITHUB_APP_ID ||
      !env.GITHUB_APP_SLUG ||
      !env.GITHUB_APP_PRIVATE_KEY ||
      !env.GITHUB_APP_CLIENT_ID ||
      !env.GITHUB_APP_CLIENT_SECRET ||
      !env.GITHUB_WEBHOOK_SECRET ||
      !env.GITHUB_OAUTH_STATE_SECRET ||
      !env.GITHUB_OAUTH_CALLBACK_URL
    ) {
      throw AppError.dependencyUnavailable('GitHub App integration is not configured');
    }
    return {
      appId: env.GITHUB_APP_ID,
      slug: env.GITHUB_APP_SLUG,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      clientId: env.GITHUB_APP_CLIENT_ID,
      clientSecret: env.GITHUB_APP_CLIENT_SECRET,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
      stateSecret: env.GITHUB_OAUTH_STATE_SECRET,
      callbackUrl: env.GITHUB_OAUTH_CALLBACK_URL,
      apiBaseUrl: env.GITHUB_API_BASE_URL,
    };
  }

  private client(config: ReturnType<GitHubService['requireConfig']>): GitHubAppClient {
    return new GitHubAppClient(config);
  }

  private assertManager(role: string): void {
    if (!MANAGER_ROLES.has(role))
      throw AppError.forbidden(
        'Only organization owners and administrators can manage GitHub installations',
      );
  }

  private rethrowGitHub(error: unknown): never {
    if (error instanceof AppError) throw error;
    if (error instanceof GitHubApiError) {
      throw AppError.dependencyUnavailable('GitHub API request failed', {
        status: error.status,
        path: error.path,
      });
    }
    throw AppError.dependencyUnavailable('GitHub integration failed');
  }

  private async uniqueSlug(organizationId: string, requested: string): Promise<string> {
    return this.uniqueProjectValue(organizationId, 'slug', requested, 80);
  }

  private async uniqueKey(organizationId: string, requested: string): Promise<string> {
    return this.uniqueProjectValue(organizationId, 'key', requested, 10);
  }

  private async uniqueProjectValue(
    organizationId: string,
    field: 'slug' | 'key',
    requested: string,
    maxLength: number,
  ): Promise<string> {
    for (let suffix = 0; suffix < 1000; suffix += 1) {
      const tail = suffix === 0 ? '' : `-${suffix + 1}`;
      const candidate = `${requested.slice(0, maxLength - tail.length)}${tail}`;
      const found = await this.prisma.project.findFirst({
        where: { organizationId, [field]: candidate },
        select: { id: true },
      });
      if (!found) return candidate;
    }
    throw AppError.conflict(
      'PROJECT_IDENTIFIER_EXHAUSTED',
      `Could not allocate a unique project ${field}`,
    );
  }
}

const installationData = (user: AuthenticatedUser, installation: GitHubInstallation) => ({
  organizationId: user.organizationId,
  externalId: installation.id,
  accountId: installation.account.id,
  accountLogin: installation.account.login,
  accountType: installation.account.type,
  accountAvatarUrl: installation.account.avatarUrl,
  repositorySelection: installation.repositorySelection,
  targetType: installation.targetType,
  permissions: installation.permissions,
  events: installation.events,
  suspendedAt: installation.suspendedAt ? new Date(installation.suspendedAt) : null,
  connectedByUserId: user.id,
});

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug.length >= 2 ? slug : `repo-${slug || 'github'}`;
};

const keyFromName = (value: string): string => {
  const key = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
  return key.length >= 2 ? key : `GH${key}`.slice(0, 10);
};

const hashState = (state: string): string => createHash('sha256').update(state).digest('hex');
const isUniqueConstraint = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002');
