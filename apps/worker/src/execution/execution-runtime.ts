import type { AgentCommandExecutor } from '@engloop/agent-sdk';
import type { CliAuthSource } from '../provider-auth';

export interface ExecutionRuntimeLimits {
  timeoutMs: number;
  allowedCommands: readonly string[];
}

export interface ExecutionRuntimeDescriptor {
  runtimeId: string;
  kind: 'HOST_PROCESS';
  isolated: false;
  workspacePath: string;
  startedAt: string;
  appliedLimits: {
    timeoutMs: number;
    allowedCommands: readonly string[];
  };
  credentialSource: CliAuthSource;
}

export interface PrepareExecutionInput {
  runId: string;
  workspacePath: string;
  limits: ExecutionRuntimeLimits;
  secretEnv: Readonly<Record<string, string>>;
  credentialSource: CliAuthSource;
}

/** Worker-owned lifecycle for provider execution. HOST_PROCESS is not a sandbox. */
export interface AgentExecutionRuntime extends AgentCommandExecutor {
  prepare(input: PrepareExecutionInput): Promise<ExecutionRuntimeDescriptor>;
  cancel(runId: string): Promise<void>;
  release(runId: string): Promise<void>;
  shutdown(): Promise<void>;
}
