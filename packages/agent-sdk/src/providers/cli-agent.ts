import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { silentLogger, type EngLoopLogger } from '@engloop/logger';
import {
  ROLE_OUTPUT_SCHEMAS,
  extractJson,
  parseSafely,
  type AgentContinuationContext,
  type AgentRunResult,
  type AgentTaskContext,
} from '@engloop/schemas';
import { AgentRole, type AgentProviderKind, type CommandResult } from '@engloop/types';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { estimateCostUsd } from '../cost';
import {
  AgentOutputInvalidError,
  type CodingAgentProvider,
  type ProviderCapabilities,
  type ProviderHealth,
} from '../provider';

export interface CliAgentOptions {
  key: string;
  name: string;
  cliPath: string;
  cliArgsPrefix?: readonly string[];
  model: string;
  executor: AgentCommandExecutor;
  logger?: EngLoopLogger;
  buildArgs: (
    context: AgentTaskContext,
    schemaFile: string,
    outputFile: string,
    schemaJson: string,
  ) => string[];
  buildResumeArgs: (
    sessionId: string,
    context: AgentContinuationContext,
    schemaFile: string,
    outputFile: string,
    schemaJson: string,
  ) => string[];
  decodeOutput?: (input: CliDecodeInput) => CliDecodedOutput | Promise<CliDecodedOutput>;
  /** Non-mutating command that proves the CLI is authenticated and usable. */
  healthArgs?: readonly string[];
  capabilities?: Partial<ProviderCapabilities>;
}

export interface AgentCommandBaseInput {
  command: string;
  args: readonly string[];
  cwd: string;
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  label?: string;
}

export type AgentCommandInput =
  | (AgentCommandBaseInput & { scope: 'health' })
  | (AgentCommandBaseInput & { scope: 'agent'; runId: string });

/** Narrow process-execution seam used by CLI providers. */
export interface AgentCommandExecutor {
  isAllowed(command: string): boolean;
  run(input: AgentCommandInput): Promise<CommandResult>;
}

export interface CliDecodeInput {
  stdout: string;
  stderr: string;
  outputFile: string;
}

export interface CliDecodedOutput {
  output: unknown;
  sessionId?: string | null;
  usage?: AgentRunResult['usage'];
  estimatedCostUsd?: number;
}

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  roles: Object.values(AgentRole),
  resumable: true,
  executesCommands: true,
  commits: true,
  models: [],
};

/** Shared safety and schema-validation boundary for CLI-driven coding agents. */
export class CliCodingAgentProvider implements CodingAgentProvider {
  readonly key: string;
  readonly name: string;
  readonly kind: AgentProviderKind;
  readonly capabilities: ProviderCapabilities;

  private readonly logger: EngLoopLogger;
  private readonly cancelled = new Set<string>();
  private readonly active = new Map<string, AbortController>();
  private readonly cliArgsPrefix: readonly string[];

  constructor(
    kind: AgentProviderKind,
    private readonly options: CliAgentOptions,
  ) {
    this.key = options.key;
    this.name = options.name;
    this.kind = kind;
    this.logger = options.logger ?? silentLogger;
    this.cliArgsPrefix = [...(options.cliArgsPrefix ?? [])];
    this.capabilities = {
      ...DEFAULT_CAPABILITIES,
      models: [options.model],
      ...options.capabilities,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    try {
      if (!this.options.executor.isAllowed(this.options.cliPath)) {
        return {
          healthy: false,
          detail: `"${this.options.cliPath}" is not in COMMAND_ALLOWLIST`,
          checkedAt: new Date().toISOString(),
        };
      }
      const result = await this.options.executor.run({
        scope: 'health',
        command: this.options.cliPath,
        args: [...this.cliArgsPrefix, ...(this.options.healthArgs ?? ['--version'])],
        cwd: process.cwd(),
        timeoutMs: 10_000,
        label: `${this.key} health`,
      });
      return {
        healthy: result.exitCode === 0,
        detail:
          result.exitCode === 0
            ? result.stdout.trim() || result.stderr.trim() || 'CLI responded'
            : result.stderr.trim() || `exit code ${String(result.exitCode)}`,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        version: this.options.healthArgs ? undefined : result.stdout.trim() || undefined,
      };
    } catch (error) {
      return {
        healthy: false,
        detail: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  async cancelRun(runId: string): Promise<void> {
    this.cancelled.add(runId);
    this.active.get(runId)?.abort();
  }

  async startRun(context: AgentTaskContext): Promise<AgentRunResult> {
    return this.withInvocationFiles(context, ({ schemaFile, outputFile, schemaJson, request }) =>
      this.invoke(
        context,
        this.options.buildArgs(context, schemaFile, outputFile, schemaJson),
        outputFile,
        null,
        request,
      ),
    );
  }

  async resumeRun(sessionId: string, context: AgentContinuationContext): Promise<AgentRunResult> {
    return this.withInvocationFiles(context, ({ schemaFile, outputFile, schemaJson, request }) =>
      this.invoke(
        context,
        this.options.buildResumeArgs(sessionId, context, schemaFile, outputFile, schemaJson),
        outputFile,
        sessionId,
        request,
      ),
    );
  }

  /** Keeps provider output/schema files out of the untrusted target worktree. */
  private async withInvocationFiles<T>(
    context: AgentTaskContext,
    invoke: (files: {
      schemaFile: string;
      outputFile: string;
      schemaJson: string;
      request: string;
    }) => Promise<T>,
  ): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'engloop-agent-'));
    const schemaFile = join(dir, 'response-schema.json');
    const outputFile = join(dir, 'output.json');

    try {
      const roleSchema = ROLE_OUTPUT_SCHEMAS[context.role as keyof typeof ROLE_OUTPUT_SCHEMAS];
      if (!roleSchema) {
        throw new AgentOutputInvalidError(
          this.key,
          [{ path: '(role)', message: `No output schema is registered for ${context.role}` }],
          '',
        );
      }
      const responseSchema = zodToJsonSchema(roleSchema, {
        $refStrategy: 'none',
        target: 'openAi',
      });
      const schemaJson = JSON.stringify(responseSchema);
      const request = JSON.stringify({
        role: context.role,
        project: context.project,
        repository: context.repository,
        memory: context.memory,
        guidance: context.guidance,
        input: context.input,
        responseSchema,
        instructions:
          'Respond with a single JSON object matching responseSchema. Do not wrap it in prose.',
      });

      await writeFile(schemaFile, JSON.stringify(responseSchema, null, 2), 'utf8');
      await writeFile(outputFile, '', 'utf8');
      return await invoke({ schemaFile, outputFile, schemaJson, request });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async invoke(
    context: AgentTaskContext,
    args: string[],
    outputFile: string,
    sessionId: string | null,
    stdin: string,
  ): Promise<AgentRunResult> {
    const startedAt = new Date();

    if (this.cancelled.has(context.runId)) {
      this.cancelled.delete(context.runId);
      return this.envelope(context, startedAt, 'CANCELLED', null, null, {
        code: 'CANCELLED',
        message: 'Cancelled before the CLI was invoked',
        retriable: false,
      });
    }

    let raw = '';
    let stderr = '';
    const controller = new AbortController();
    this.active.set(context.runId, controller);
    try {
      const result = await this.options.executor.run({
        scope: 'agent',
        runId: context.runId,
        command: this.options.cliPath,
        args: [...this.cliArgsPrefix, ...args],
        cwd: context.workspacePath,
        stdin,
        signal: controller.signal,
        timeoutMs: context.budget.timeoutMs,
        label: `${this.key}:${context.role}`,
      });
      raw = result.stdout;
      stderr = result.stderr;
      if (result.exitCode !== 0) {
        return this.envelope(context, startedAt, 'FAILED', null, raw, {
          code: 'CLI_NON_ZERO_EXIT',
          message: result.stderr.trim() || `exit code ${String(result.exitCode)}`,
          retriable: true,
        });
      }
    } catch (error) {
      const cancelled =
        this.cancelled.delete(context.runId) ||
        (error instanceof Error && error.name === 'AbortError');
      if (cancelled) {
        return this.envelope(context, startedAt, 'CANCELLED', null, raw, {
          code: 'CANCELLED',
          message: 'Agent run was cancelled',
          retriable: false,
        });
      }
      const timedOut = error instanceof Error && error.name === 'CommandTimeoutError';
      return this.envelope(context, startedAt, timedOut ? 'TIMED_OUT' : 'FAILED', null, raw, {
        code: timedOut ? 'AGENT_TIMEOUT' : 'CLI_INVOCATION_FAILED',
        message: error instanceof Error ? error.message : String(error),
        retriable: !timedOut,
      });
    } finally {
      this.active.delete(context.runId);
    }

    let decoded: CliDecodedOutput;
    try {
      decoded = this.options.decodeOutput
        ? await this.options.decodeOutput({ stdout: raw, stderr, outputFile })
        : { output: extractJson(raw) };
    } catch (error) {
      this.logger.warn({ provider: this.key, role: context.role }, 'agent.output.unparsable');
      throw new AgentOutputInvalidError(
        this.key,
        [{ path: '(transport)', message: error instanceof Error ? error.message : String(error) }],
        raw,
      );
    }

    const schema = ROLE_OUTPUT_SCHEMAS[context.role as keyof typeof ROLE_OUTPUT_SCHEMAS];
    const parsed = parseSafely(schema, decoded.output, `${this.key} ${context.role} output`);
    if (!parsed.ok) throw new AgentOutputInvalidError(this.key, parsed.issues, raw);

    const completed = this.envelope(
      context,
      startedAt,
      'SUCCEEDED',
      parsed.data,
      raw,
      null,
      decoded.sessionId ?? sessionId,
      decoded.usage,
      decoded.estimatedCostUsd,
    );
    if (
      completed.usage.totalTokens > context.budget.maxTokens ||
      completed.estimatedCostUsd > context.budget.maxCostUsd
    ) {
      return {
        ...completed,
        status: 'BUDGET_EXCEEDED',
        output: null,
        error: {
          code: 'AGENT_BUDGET_EXCEEDED',
          message: `Provider usage exceeded the run budget (${completed.usage.totalTokens}/${context.budget.maxTokens} tokens, $${completed.estimatedCostUsd.toFixed(6)}/$${context.budget.maxCostUsd.toFixed(6)})`,
          retriable: false,
        },
      };
    }
    return completed;
  }

  private envelope(
    context: AgentTaskContext,
    startedAt: Date,
    status: AgentRunResult['status'],
    output: unknown,
    rawOutput: string | null,
    error: AgentRunResult['error'] = null,
    sessionId: string | null = null,
    providerUsage?: AgentRunResult['usage'],
    providerCostUsd?: number,
  ): AgentRunResult {
    const completedAt = new Date();
    const inputTokens = Math.ceil(JSON.stringify(context.input ?? {}).length / 4);
    const outputTokens = Math.ceil((rawOutput?.length ?? 0) / 4);
    const estimatedUsage = {
      inputTokens,
      outputTokens,
      cachedTokens: 0,
      totalTokens: inputTokens + outputTokens,
    };

    return {
      runId: context.runId,
      sessionId,
      status,
      output,
      rawOutput,
      usage: providerUsage ?? estimatedUsage,
      estimatedCostUsd:
        providerCostUsd ?? estimateCostUsd(providerUsage ?? estimatedUsage, this.options.model),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      error,
      messages: [],
    };
  }
}
