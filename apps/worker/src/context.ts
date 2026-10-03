import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { getEnv, SecretCipher, type Env } from '@engloop/config';
import { createLogger, type EngLoopLogger } from '@engloop/logger';
import { getPrismaClient, type PrismaClient } from '@engloop/db';
import {
  AgentProviderRegistry,
  ClaudeCodeAgentProvider,
  CodexAgentProvider,
  MockAgentProvider,
} from '@engloop/agent-sdk';
import { CommandRunner, GitService, WorktreeManager } from '@engloop/git';
import { GitHubAppClient } from '@engloop/github';
import { AuditWriter } from './services/audit-writer';
import { ContextBuilder } from './services/context-builder';
import { AgentExecutor } from './services/agent-executor';
import { TestRunner } from './services/test-runner';
import { ReviewEngine } from './services/review-engine';
import { GitManager } from './services/git-manager';
import { PlanMaterializer } from './services/plan-materializer';
import { UsageRecorder } from './services/usage-recorder';
import { CredentialResolver } from './services/credential-resolver';
import {
  ContainerExecutionRuntime,
  HostProcessExecutionRuntime,
  type AgentExecutionRuntime,
} from './execution';

export interface WorkerContext {
  env: Env;
  logger: EngLoopLogger;
  prisma: PrismaClient;
  registry: AgentProviderRegistry;
  runner: CommandRunner;
  executionRuntime: AgentExecutionRuntime;
  git: GitService;
  worktrees: WorktreeManager;
  audit: AuditWriter;
  usage: UsageRecorder;
  contextBuilder: ContextBuilder;
  agents: AgentExecutor;
  tests: TestRunner;
  reviews: ReviewEngine;
  gitManager: GitManager;
  plans: PlanMaterializer;
  /** Decrypts each organization's UI-configured provider keys. */
  credentials: CredentialResolver;
}

/**
 * Composition root for the worker process.
 *
 * Wiring lives here and nowhere else: every service takes its collaborators as
 * constructor arguments, which is what makes the step handlers unit-testable
 * with fakes.
 */
export const createWorkerContext = (): WorkerContext => {
  const env = getEnv();
  const logger = createLogger({
    service: 'engloop-worker',
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY,
  });
  const prisma = getPrismaClient({ databaseUrl: env.DATABASE_URL });

  const runner = new CommandRunner({
    allowlist: env.COMMAND_ALLOWLIST,
    defaultTimeoutMs: env.COMMAND_TIMEOUT_MS,
    maxBufferBytes: env.COMMAND_MAX_BUFFER_BYTES,
    logger,
  });

  const git = new GitService({
    runner,
    identity: { name: env.GIT_AUTHOR_NAME, email: env.GIT_AUTHOR_EMAIL },
    logger,
  });

  const worktrees = new WorktreeManager({ workspaceRoot: env.WORKSPACE_ROOT, git, logger });
  const github =
    env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY
      ? new GitHubAppClient({
          appId: env.GITHUB_APP_ID,
          privateKey: env.GITHUB_APP_PRIVATE_KEY,
          clientId: env.GITHUB_APP_CLIENT_ID,
          clientSecret: env.GITHUB_APP_CLIENT_SECRET,
          apiBaseUrl: env.GITHUB_API_BASE_URL,
        })
      : undefined;

  const registry = new AgentProviderRegistry(logger);
  const executionRuntime = createExecutionRuntime(env, runner, logger);
  const credentials = new CredentialResolver({
    prisma,
    cipher: new SecretCipher(env.SECRETS_ENCRYPTION_KEY),
    logger,
  });

  if (env.AGENT_ENABLE_MOCK) {
    registry.register(
      new MockAgentProvider({
        latencyMs: env.AGENT_MOCK_LATENCY_MS,
        failureRate: env.AGENT_MOCK_FAILURE_RATE,
      }),
    );
  }

  registry
    .register(
      new CodexAgentProvider({
        cliPath: env.CODEX_CLI_PATH,
        model: env.CODEX_MODEL,
        // A sandboxed worktree's .git points at a host path that is not mounted.
        skipGitRepoCheck: executionRuntime.kind === 'CONTAINER',
        executor: executionRuntime,
        logger,
      }),
    )
    .register(
      new ClaudeCodeAgentProvider({
        cliPath: env.CLAUDE_CODE_CLI_PATH,
        model: env.CLAUDE_CODE_MODEL,
        executor: executionRuntime,
        logger,
      }),
    );

  const audit = new AuditWriter(prisma, logger);
  const usage = new UsageRecorder(prisma);
  const contextBuilder = new ContextBuilder(prisma, env);
  const agents = new AgentExecutor({
    prisma,
    registry,
    logger,
    env,
    audit,
    usage,
    contextBuilder,
    credentials,
    executionRuntime,
  });
  const tests = new TestRunner({ prisma, runner, logger, env, audit });
  const reviews = new ReviewEngine({ prisma, logger });
  const gitManager = new GitManager({ prisma, git, worktrees, github, logger, env, audit });
  const plans = new PlanMaterializer(prisma);

  return {
    env,
    logger,
    prisma,
    registry,
    runner,
    executionRuntime,
    git,
    worktrees,
    audit,
    usage,
    contextBuilder,
    agents,
    tests,
    reviews,
    gitManager,
    plans,
    credentials,
  };
};

const defaultSandboxUser = (): string => {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  // A root worker gets the conventional unprivileged nobody user instead.
  return uid === undefined || uid === 0 || gid === undefined
    ? '65534:65534'
    : `${String(uid)}:${String(gid)}`;
};

export const createExecutionRuntime = (
  env: Env,
  runner: CommandRunner,
  logger: EngLoopLogger,
): AgentExecutionRuntime => {
  if (env.AGENT_EXECUTION_RUNTIME === 'host') {
    logger.warn({}, 'agent.runtime.host_process_unisolated');
    return new HostProcessExecutionRuntime({
      runner,
      healthEnv: env.CODEX_HOME ? { CODEX_HOME: env.CODEX_HOME } : undefined,
    });
  }
  // Docker is the only executable the container runtime spawns on the host.
  const docker = new CommandRunner({
    allowlist: [env.AGENT_SANDBOX_DOCKER_PATH],
    defaultTimeoutMs: env.COMMAND_TIMEOUT_MS,
    maxBufferBytes: env.COMMAND_MAX_BUFFER_BYTES,
    envAllowlist: [
      'PATH',
      'HOME',
      'DOCKER_HOST',
      'DOCKER_CONFIG',
      'DOCKER_CONTEXT',
      'DOCKER_CERT_PATH',
      'DOCKER_TLS_VERIFY',
      'SYSTEMROOT',
      'PATHEXT',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'TEMP',
      'TMP',
    ],
    logger,
  });
  return new ContainerExecutionRuntime({
    runner: docker,
    logger,
    config: {
      dockerPath: env.AGENT_SANDBOX_DOCKER_PATH,
      image: env.AGENT_SANDBOX_IMAGE,
      proxyImage: env.AGENT_SANDBOX_PROXY_IMAGE ?? env.AGENT_SANDBOX_IMAGE,
      user: env.AGENT_SANDBOX_USER ?? defaultSandboxUser(),
      owner: env.AGENT_SANDBOX_OWNER ?? hostname(),
      scratchRoot: join(resolve(env.WORKSPACE_ROOT), 'sandbox'),
      cpus: env.AGENT_SANDBOX_CPUS,
      memoryMb: env.AGENT_SANDBOX_MEMORY_MB,
      pidsLimit: env.AGENT_SANDBOX_PIDS_LIMIT,
      tmpfsMb: env.AGENT_SANDBOX_TMPFS_MB,
      egressAllowlist: env.AGENT_SANDBOX_EGRESS_ALLOWLIST,
      egressNetwork: env.AGENT_SANDBOX_EGRESS_NETWORK,
      commandAllowlist: env.COMMAND_ALLOWLIST,
    },
  });
};
