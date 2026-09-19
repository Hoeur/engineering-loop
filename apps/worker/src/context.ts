import { getEnv, type Env } from '@engloop/config';
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
import { claudeCodeCliAuth, codexCliAuth, type CliAuthSource } from './provider-auth';

export interface WorkerContext {
  env: Env;
  logger: EngLoopLogger;
  prisma: PrismaClient;
  registry: AgentProviderRegistry;
  runner: CommandRunner;
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
  /** Where each CLI provider gets its credentials: a configured API key or its own login. */
  providerAuth: Record<string, CliAuthSource>;
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
  const codexAuth = codexCliAuth(env);
  const claudeCodeAuth = claudeCodeCliAuth(env);

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
        runner,
        logger,
        env: (): Record<string, string> => ({ ...codexAuth.env }),
      }),
    )
    .register(
      new ClaudeCodeAgentProvider({
        cliPath: env.CLAUDE_CODE_CLI_PATH,
        model: env.CLAUDE_CODE_MODEL,
        runner,
        logger,
        env: (): Record<string, string> => ({ ...claudeCodeAuth.env }),
      }),
    );

  const audit = new AuditWriter(prisma, logger);
  const usage = new UsageRecorder(prisma);
  const contextBuilder = new ContextBuilder(prisma, env);
  const agents = new AgentExecutor({ prisma, registry, logger, env, audit, usage, contextBuilder });
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
    providerAuth: { codex: codexAuth.source, 'claude-code': claudeCodeAuth.source },
  };
};
