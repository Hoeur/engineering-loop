import type { AgentCommandExecutor } from '@engloop/agent-sdk';
import type { CliAuthSource } from '../provider-auth';

export type ExecutionRuntimeKind = 'HOST_PROCESS' | 'CONTAINER';

/** One `host:port` destination an agent may reach. `*.example.com` matches subdomains. */
export type EgressRule = string;

export interface ExecutionRuntimeLimits {
  timeoutMs: number;
  allowedCommands: readonly string[];
  /** Destinations reachable from the run. Empty means no network at all. */
  egressAllowlist?: readonly EgressRule[];
}

export interface ContainerAppliedLimits {
  cpus: number;
  memoryMb: number;
  pidsLimit: number;
  tmpfsMb: number;
  readOnlyRootFs: true;
  network: 'none' | 'egress-proxy';
  egressAllowlist: readonly EgressRule[];
}

export interface ExecutionRuntimeDescriptor {
  runtimeId: string;
  kind: ExecutionRuntimeKind;
  isolated: boolean;
  workspacePath: string;
  startedAt: string;
  appliedLimits: {
    timeoutMs: number;
    allowedCommands: readonly string[];
    container?: ContainerAppliedLimits;
  };
  credentialSource: CliAuthSource;
  image?: string;
}

/** Why the runtime ended. Limit reasons are enforced by the runtime, not reported by the agent. */
export type ExecutionExitReason =
  | 'COMPLETED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'MEMORY_LIMIT'
  | 'SHUTDOWN'
  | 'RUNTIME_ERROR';

export interface ExecutionRuntimeReport {
  runtimeId: string;
  kind: ExecutionRuntimeKind;
  exitReason: ExecutionExitReason;
  /** Destinations the egress proxy refused, deduplicated. */
  deniedEgress: readonly string[];
  resourceUsage?: {
    memoryPeakBytes?: number;
    oomKills?: number;
  };
}

/** Runtime-enforced limit violations end the run regardless of what the provider returned. */
export const LIMIT_EXIT_REASONS: ReadonlySet<ExecutionExitReason> = new Set([
  'TIMEOUT',
  'MEMORY_LIMIT',
]);

export interface PrepareExecutionInput {
  runId: string;
  workspacePath: string;
  limits: ExecutionRuntimeLimits;
  secretEnv: Readonly<Record<string, string>>;
  credentialSource: CliAuthSource;
}

/** Worker-owned lifecycle for provider execution. HOST_PROCESS is not a sandbox. */
export interface AgentExecutionRuntime extends AgentCommandExecutor {
  readonly kind: ExecutionRuntimeKind;
  prepare(input: PrepareExecutionInput): Promise<ExecutionRuntimeDescriptor>;
  cancel(runId: string): Promise<void>;
  release(runId: string): Promise<ExecutionRuntimeReport | null>;
  /** Remove execution resources a crashed worker left behind. */
  recover(): Promise<number>;
  shutdown(): Promise<void>;
}
