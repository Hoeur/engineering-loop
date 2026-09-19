import { createPrivateKey } from 'node:crypto';
import { z } from 'zod';

import { loadDotEnvOnce } from './dotenv';

const bool = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) =>
      typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
    );

const int = (defaultValue: number) =>
  z.coerce.number().int().default(defaultValue) as unknown as z.ZodType<number>;

const csv = (defaultValue: string[]) =>
  z
    .union([z.string(), z.array(z.string())])
    .default(defaultValue)
    .transform((value) =>
      (Array.isArray(value) ? value : value.split(','))
        .map((entry) => entry.trim())
        .filter(Boolean),
    );

const optionalSecret = z
  .string()
  .transform((value) => value.trim())
  .optional()
  .transform((value) => value || undefined);

const githubPlaceholder = /(change[-_ ]?me|placeholder|your[-_ ]|example)/i;

/**
 * Shared environment contract.
 *
 * Every service validates process.env against this at boot and fails fast with a
 * readable report rather than surfacing `undefined` deep inside a queue worker.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: bool(false),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: int(6379),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_URL: z.string().optional(),
    QUEUE_PREFIX: z.string().default('engloop'),

    API_PORT: int(4000),
    API_HOST: z.string().default('0.0.0.0'),
    API_GLOBAL_PREFIX: z.string().default('api'),
    // `localhost` and `127.0.0.1` are different origins to a browser. Allowing both
    // by default means opening the app at either address works; a CORS rejection
    // surfaces in the browser only as an opaque "Failed to fetch", which is a
    // miserable thing to debug.
    API_CORS_ORIGINS: csv(['http://localhost:3000', 'http://127.0.0.1:3000']),
    SWAGGER_ENABLED: bool(true),

    WORKER_CONCURRENCY: int(4),
    WORKER_HEALTH_PORT: int(4100),

    AUTH_JWT_SECRET: z.string().min(16, 'AUTH_JWT_SECRET must be at least 16 characters'),
    AUTH_JWT_EXPIRES_IN: z.string().default('7d'),
    AUTH_DEV_BYPASS: bool(false),
    AUTH_DEV_USER_EMAIL: z.string().email().default('founder@evalley.dev'),

    SECRETS_ENCRYPTION_KEY: z.string().min(16, 'SECRETS_ENCRYPTION_KEY must be set'),

    AGENT_DEFAULT_PROVIDER: z.string().default('codex'),
    AGENT_ENABLE_MOCK: bool(false),
    AGENT_MOCK_LATENCY_MS: int(600),
    AGENT_MOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
    AGENT_MAX_REVIEW_CYCLES: int(3),
    AGENT_MAX_ATTEMPTS: int(3),
    AGENT_RUN_TIMEOUT_MS: int(900_000),
    AGENT_TOKEN_BUDGET: int(200_000),
    AGENT_COST_BUDGET_USD: z.coerce.number().default(5),

    CODEX_CLI_PATH: z.string().default('codex'),
    CODEX_HOME: z.string().optional(),
    CODEX_MODEL: z.string().default('gpt-6-astra'),
    OPENAI_API_KEY: z.string().optional(),
    CLAUDE_CODE_CLI_PATH: z.string().default('claude'),
    CLAUDE_CODE_MODEL: z.string().default('claude-opus-5'),
    ANTHROPIC_API_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),

    WORKSPACE_ROOT: z.string().default('./workspace'),
    GIT_AUTHOR_NAME: z.string().default('EngLoop Agent'),
    GIT_AUTHOR_EMAIL: z.string().default('agents@engloop.dev'),
    GIT_DEFAULT_BASE_BRANCH: z.string().default('main'),
    GIT_BRANCH_PREFIX: z.string().default('agent'),

    GITHUB_APP_ID: optionalSecret,
    GITHUB_APP_SLUG: optionalSecret,
    GITHUB_APP_PRIVATE_KEY: optionalSecret,
    GITHUB_APP_CLIENT_ID: optionalSecret,
    GITHUB_APP_CLIENT_SECRET: optionalSecret,
    GITHUB_WEBHOOK_SECRET: optionalSecret,
    GITHUB_OAUTH_STATE_SECRET: optionalSecret,
    GITHUB_OAUTH_CALLBACK_URL: optionalSecret,
    GITHUB_API_BASE_URL: z.string().url().default('https://api.github.com'),

    COMMAND_TIMEOUT_MS: int(600_000),
    COMMAND_MAX_BUFFER_BYTES: int(10 * 1024 * 1024),
    COMMAND_ALLOWLIST: csv([
      'pnpm',
      'npm',
      'node',
      'npx',
      'git',
      'bash',
      'sh',
      'make',
      'tsc',
      'eslint',
      'prettier',
      'vitest',
      'jest',
      'playwright',
      'codex',
      'codex.exe',
      'claude',
      'claude.exe',
    ]),

    UI_QA_ENABLED: bool(false),
    UI_QA_BASE_URL: z.string().default('http://localhost:3000'),
  })
  .superRefine((env, ctx) => {
    const fields = [
      'GITHUB_APP_ID',
      'GITHUB_APP_SLUG',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_APP_CLIENT_ID',
      'GITHUB_APP_CLIENT_SECRET',
      'GITHUB_WEBHOOK_SECRET',
      'GITHUB_OAUTH_STATE_SECRET',
      'GITHUB_OAUTH_CALLBACK_URL',
    ] as const;
  const githubConfigured = fields.some((field) => Boolean(env[field]));
  if (!githubConfigured) return;

  const githubComplete = fields.every((field) => Boolean(env[field]));
  if (!githubComplete && env.NODE_ENV !== 'production') return;

  for (const field of fields) {
      const value = env[field];
      if (!value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when GitHub App integration is configured`,
        });
      } else if (githubPlaceholder.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} contains a placeholder value`,
        });
      }
    }
    if (
      env.GITHUB_APP_ID &&
      (!/^\d+$/.test(env.GITHUB_APP_ID) || BigInt(env.GITHUB_APP_ID) <= 0n)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GITHUB_APP_ID'],
        message: 'GITHUB_APP_ID must be a positive integer',
      });
    }
    if (env.GITHUB_APP_PRIVATE_KEY) {
      try {
        createPrivateKey(env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'));
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GITHUB_APP_PRIVATE_KEY'],
          message: 'GITHUB_APP_PRIVATE_KEY must be a valid PEM private key',
        });
      }
    }
    if (env.GITHUB_WEBHOOK_SECRET && env.GITHUB_WEBHOOK_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GITHUB_WEBHOOK_SECRET'],
        message: 'GITHUB_WEBHOOK_SECRET must be at least 32 characters',
      });
    }
    if (env.GITHUB_OAUTH_STATE_SECRET && env.GITHUB_OAUTH_STATE_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GITHUB_OAUTH_STATE_SECRET'],
        message: 'GITHUB_OAUTH_STATE_SECRET must be at least 32 characters',
      });
    }
    if (env.GITHUB_OAUTH_CALLBACK_URL) {
      try {
        const url = new URL(env.GITHUB_OAUTH_CALLBACK_URL);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GITHUB_OAUTH_CALLBACK_URL'],
          message: 'GITHUB_OAUTH_CALLBACK_URL must be an absolute HTTP(S) URL',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

/** Parses (and caches) the environment. Throws a single readable error on failure. */
export const parseEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
};

let cached: Env | undefined;

export const getEnv = (): Env => {
  if (!cached) {
    loadDotEnvOnce();
    cached = parseEnv();
  }
  return cached;
};

/** Test hook — lets suites inject a fixture environment. */
export const setEnvForTesting = (env: Env | undefined): void => {
  cached = env;
};
