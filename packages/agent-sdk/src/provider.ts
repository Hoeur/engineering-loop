import type { AgentProviderKind, AgentRole } from '@engloop/types';
import type { AgentContinuationContext, AgentRunResult, AgentTaskContext } from '@engloop/schemas';

export interface ProviderCapabilities {
  /** Roles this provider is able to serve. */
  roles: readonly AgentRole[];
  /** Can continue a previous session instead of starting cold. */
  resumable: boolean;
  /** Executes shell commands inside the worktree (CLI agents) vs. pure API calls. */
  executesCommands: boolean;
  /** Produces git commits itself. */
  commits: boolean;
  models: readonly string[];
}

export interface ProviderHealth {
  healthy: boolean;
  detail: string;
  checkedAt: string;
  latencyMs?: number;
  version?: string;
}

/**
 * The single seam between EngLoop's business logic and any coding agent
 * (spec section 8). Nothing outside `providers/` may reference Codex, Claude Code
 * or any other vendor by name.
 */
export interface CodingAgentProvider {
  readonly key: string;
  readonly name: string;
  readonly kind: AgentProviderKind;
  readonly capabilities: ProviderCapabilities;

  startRun(context: AgentTaskContext): Promise<AgentRunResult>;
  resumeRun(sessionId: string, context: AgentContinuationContext): Promise<AgentRunResult>;
  cancelRun(runId: string): Promise<void>;
  healthCheck(): Promise<ProviderHealth>;
}

export class ProviderUnavailableError extends Error {
  readonly code = 'AGENT_PROVIDER_UNAVAILABLE';
  constructor(providerKey: string, detail: string) {
    super(`Agent provider "${providerKey}" is unavailable: ${detail}`);
    this.name = 'ProviderUnavailableError';
  }
}

export class AgentOutputInvalidError extends Error {
  readonly code = 'AGENT_OUTPUT_INVALID';
  constructor(
    providerKey: string,
    public readonly issues: { path: string; message: string }[],
    public readonly raw: string,
  ) {
    super(
      `Agent provider "${providerKey}" returned output that failed schema validation: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'AgentOutputInvalidError';
  }
}

export class AgentBudgetExceededError extends Error {
  readonly code = 'AGENT_BUDGET_EXCEEDED';
  constructor(providerKey: string, detail: string) {
    super(`Agent provider "${providerKey}" exceeded its budget: ${detail}`);
    this.name = 'AgentBudgetExceededError';
  }
}
