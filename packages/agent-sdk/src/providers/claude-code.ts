import { extractJson, type AgentTaskContext } from '@engloop/schemas';
import { AgentProviderKind, AgentRole } from '@engloop/types';
import { z } from 'zod';
import {
  CliCodingAgentProvider,
  type CliAgentOptions,
  type CliDecodedOutput,
  type CliDecodeInput,
} from './cli-agent';

export interface ClaudeCodeProviderOptions
  extends Omit<
    CliAgentOptions,
    'key' | 'name' | 'buildArgs' | 'buildResumeArgs' | 'decodeOutput' | 'capabilities'
  > {
  key?: string;
  name?: string;
}

const claudeUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cache_creation_input_tokens: z.number().int().nonnegative().optional(),
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();
const claudeEnvelopeSchema = z
  .object({
    type: z.string().optional(),
    is_error: z.boolean().optional(),
    result: z.unknown().optional(),
    structured_output: z.unknown().optional(),
    session_id: z.string().min(1).optional(),
    usage: claudeUsageSchema.optional(),
    total_cost_usd: z.number().nonnegative().optional(),
  })
  .passthrough();

export const decodeClaudeOutput = (input: CliDecodeInput): CliDecodedOutput => {
  let value: unknown;
  try {
    value = JSON.parse(input.stdout);
  } catch {
    throw new Error('Claude output is not valid JSON');
  }
  const parsed = claudeEnvelopeSchema.safeParse(value);
  if (!parsed.success) throw new Error('Claude output is not a valid result envelope');
  if (parsed.data.is_error === true) throw new Error('Claude returned an error result');

  const candidate = parsed.data.structured_output ?? parsed.data.result;
  if (candidate === undefined) throw new Error('Claude result did not contain structured output');

  const usageEnvelope = parsed.data.usage;
  let usage: CliDecodedOutput['usage'];
  if (usageEnvelope) {
    const cachedTokens = usageEnvelope.cache_read_input_tokens ?? 0;
    const inputTokens =
      (usageEnvelope.input_tokens ?? 0) +
      (usageEnvelope.cache_creation_input_tokens ?? 0) +
      cachedTokens;
    const outputTokens = usageEnvelope.output_tokens ?? 0;
    usage = { inputTokens, outputTokens, cachedTokens, totalTokens: inputTokens + outputTokens };
  }

  return {
    output: typeof candidate === 'string' ? extractJson(candidate) : candidate,
    sessionId: parsed.data.session_id,
    usage,
    estimatedCostUsd: parsed.data.total_cost_usd,
  };
};

/** Roles that change code. Every other role plans or reviews and stays read-only. */
const IMPLEMENTATION_ROLES: ReadonlySet<string> = new Set<string>([
  AgentRole.IMPLEMENTER,
  AgentRole.BACKEND_DEVELOPER,
  AgentRole.FRONTEND_DEVELOPER,
  AgentRole.DATABASE_ENGINEER,
  AgentRole.DEVOPS_ENGINEER,
]);

/** Tools that write files or run commands. */
const MUTATING_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'];

const LOCKFILE_INSTALL: Record<string, string> = {
  npm: 'npm ci',
  pnpm: 'pnpm install --frozen-lockfile',
  yarn: 'yarn install --frozen-lockfile',
  bun: 'bun install --frozen-lockfile',
};

/**
 * Shell commands an implementer may run without a prompt: read-only git, a
 * lockfile-exact install and the repository's check scripts — the same things
 * EngLoop runs itself to verify. Never `git commit`/`push` (EngLoop commits) and
 * never a dependency change. Claude Code also refuses a chained command unless
 * every part of the chain matches a rule.
 */
export const claudeImplementerCommandRules = (packageManager?: string | null): string[] => {
  const requested = (packageManager ?? '').toLowerCase();
  const manager = requested in LOCKFILE_INSTALL ? requested : 'npm';
  const scripts = ['lint', 'typecheck', 'test', 'build'];
  const commands = [
    'git status',
    'git diff',
    'git log',
    'git show',
    LOCKFILE_INSTALL[manager] ?? 'npm ci',
    ...scripts.map((script) => `${manager} run ${script}`),
    ...(manager === 'npm' ? ['npm test'] : scripts.map((script) => `${manager} ${script}`)),
  ];
  return commands.map((command) => `Bash(${command}:*)`);
};

/**
 * Headless (`-p`) Claude Code cannot ask for permission, so the role decides up
 * front: planners and reviewers may only read; implementers may edit files inside
 * their working directory (the task worktree) and run the commands above.
 * Explicit rules also override whatever the operator's own Claude settings allow.
 */
export const claudePermissionArgs = (
  context: Pick<AgentTaskContext, 'role' | 'repository'>,
): string[] =>
  IMPLEMENTATION_ROLES.has(context.role)
    ? [
        '--permission-mode',
        'acceptEdits',
        '--allowedTools',
        ...claudeImplementerCommandRules(context.repository.packageManager),
      ]
    : ['--disallowedTools', ...MUTATING_TOOLS];

export class ClaudeCodeAgentProvider extends CliCodingAgentProvider {
  constructor(options: ClaudeCodeProviderOptions) {
    super(AgentProviderKind.CLAUDE_CODE, {
      ...options,
      key: options.key ?? 'claude-code',
      name: options.name ?? 'Claude Code',
      // Permission flags are variadic, so they sit before `--output-format`, which ends them.
      buildArgs: (context, _schemaFile, _outputFile, schemaJson) => [
        '-p',
        '--model',
        options.model,
        ...claudePermissionArgs(context),
        '--output-format',
        'json',
        '--json-schema',
        schemaJson,
      ],
      buildResumeArgs: (sessionId, context, _schemaFile, _outputFile, schemaJson) => [
        '-p',
        '--resume',
        sessionId,
        '--model',
        options.model,
        ...claudePermissionArgs(context),
        '--output-format',
        'json',
        '--json-schema',
        schemaJson,
      ],
      decodeOutput: decodeClaudeOutput,
      capabilities: {
        // Planning and review roles run read-only (see claudePermissionArgs), which
        // is what lets one provider cover every mandatory workflow role.
        roles: [
          AgentRole.ARCHITECT,
          AgentRole.PLANNER,
          AgentRole.IMPLEMENTER,
          AgentRole.BACKEND_DEVELOPER,
          AgentRole.FRONTEND_DEVELOPER,
          AgentRole.DATABASE_ENGINEER,
          AgentRole.DEVOPS_ENGINEER,
          AgentRole.CODE_REVIEWER,
          AgentRole.SECURITY_REVIEWER,
          AgentRole.PERFORMANCE_REVIEWER,
        ],
        resumable: true,
        executesCommands: true,
        commits: true,
      },
    });
  }
}
