/** Platform-wide constants that are not environment dependent. */

export const QUEUE_NAMES = Object.freeze({
  WORKFLOW: 'workflow',
  AGENT: 'agent',
  TESTS: 'tests',
  REVIEW: 'review',
  GIT: 'git',
  SCHEDULER: 'scheduler',
  NOTIFICATIONS: 'notifications',
  UI_QA: 'ui-qa',
});
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = Object.freeze({
  ADVANCE_WORKFLOW: 'workflow.advance',
  START_WORKFLOW: 'workflow.start',
  CANCEL_WORKFLOW: 'workflow.cancel',
  RUN_AGENT: 'agent.run',
  RUN_TESTS: 'tests.run',
  RUN_REVIEW: 'review.run',
  RUN_UI_QA: 'ui-qa.run',
  FIRE_SCHEDULE: 'schedule.fire',
  DISPATCH_NOTIFICATION: 'notification.dispatch',
});

export const DEFAULT_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { age: 60 * 60 * 24, count: 5_000 },
  removeOnFail: { age: 60 * 60 * 24 * 7 },
});

/** Default deterministic checks every task must pass before review. */
export const DEFAULT_REQUIRED_CHECKS = Object.freeze(['LINT', 'TYPECHECK', 'UNIT', 'BUILD']);

export const DEFAULT_PROJECT_COMMANDS = Object.freeze({
  install: 'pnpm install --frozen-lockfile',
  lint: 'pnpm lint',
  typecheck: 'pnpm typecheck',
  unit: 'pnpm test',
  integration: 'pnpm test:integration',
  build: 'pnpm build',
  e2e: 'pnpm test:e2e',
});

/**
 * Where an agent's structured request is written inside the worktree.
 *
 * Transient scaffolding, never part of the change under review: the commit step
 * excludes this path so prompt files cannot leak into a diff or a pull request.
 */

/** Repository files harvested to build agent context (spec section 17). */
export const AGENT_CONTEXT_FILES = Object.freeze([
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  '.ai/architecture.md',
  '.ai/coding-standards.md',
  '.ai/testing.md',
  '.ai/security.md',
  '.ai/ui-guidelines.md',
]);

export const MAX_CONTEXT_FILE_BYTES = 64 * 1024;
export const MAX_DIFF_BYTES = 512 * 1024;
export const MAX_LOG_BYTES = 256 * 1024;

/** Indicative USD per million tokens; real pricing is loaded per provider config. */
export const FALLBACK_TOKEN_PRICING = Object.freeze({
  inputPerMillionUsd: 3,
  outputPerMillionUsd: 15,
  cachedPerMillionUsd: 0.3,
});
