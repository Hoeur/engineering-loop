import type { AgentCommandExecutor } from '@engloop/agent-sdk';
import type { CliAuthSource } from '../provider-auth';

export interface ExecutionRuntimeLimits {
  timeoutMs: number;
  allowedCommands: readonly string[];
}

interface ExecutionRuntimeDescriptorBase {
  runtimeId: string;
  workspacePath: string;
  startedAt: string;
  credentialSource: CliAuthSource;
}

export interface HostProcessRuntimeDescriptor extends ExecutionRuntimeDescriptorBase {
  kind: 'HOST_PROCESS';
  isolated: false;
  appliedLimits: {
    timeoutMs: number;
    allowedCommands: readonly string[];
  };
}

export interface DockerContainerRuntimeDescriptor extends ExecutionRuntimeDescriptorBase {
  kind: 'DOCKER_CONTAINER';
  isolated: true;
  containerName: string;
  appliedLimits: {
    timeoutMs: number;
    allowedCommands: readonly string[];
    cpuCount: number;
    memoryBytes: number;
    pids: number;
    network: 'none';
  };
}

export type ExecutionRuntimeDescriptor =
  | HostProcessRuntimeDescriptor
  | DockerContainerRuntimeDescriptor;

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
