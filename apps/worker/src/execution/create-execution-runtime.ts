import { resolve } from 'node:path';
import type { Env } from '@engloop/config';
import { CommandRunner } from '@engloop/git';
import { DockerContainerExecutionRuntime } from './docker-container-execution-runtime';
import type { AgentExecutionRuntime } from './execution-runtime';
import { HostProcessExecutionRuntime } from './host-process-execution-runtime';

export const configuredProviderCommand = (env: Env, providerKind: string): string => {
  if (providerKind === 'CODEX') {
    return env.AGENT_EXECUTION_RUNTIME === 'DOCKER'
      ? env.AGENT_CONTAINER_CODEX_CLI_PATH
      : env.CODEX_CLI_PATH;
  }
  if (providerKind === 'CLAUDE_CODE') {
    return env.AGENT_EXECUTION_RUNTIME === 'DOCKER'
      ? env.AGENT_CONTAINER_CLAUDE_CODE_CLI_PATH
      : env.CLAUDE_CODE_CLI_PATH;
  }
  throw new Error(`No execution command is configured for provider kind ${providerKind}`);
};

export const createAgentExecutionRuntime = (
  env: Env,
  runner: CommandRunner,
): AgentExecutionRuntime => {
  if (
    env.NODE_ENV === 'production' &&
    env.AGENT_EXECUTION_RUNTIME === 'HOST_PROCESS' &&
    (!env.AGENT_ENABLE_MOCK || env.AGENT_DEFAULT_PROVIDER !== 'mock')
  ) {
    throw new Error('Production CLI execution requires DOCKER');
  }
  return env.AGENT_EXECUTION_RUNTIME === 'DOCKER'
    ? new DockerContainerExecutionRuntime({
        runner,
        dockerRunner: new CommandRunner({
          allowlist: [env.AGENT_CONTAINER_DOCKER_PATH],
          defaultTimeoutMs: env.COMMAND_TIMEOUT_MS,
          maxBufferBytes: env.COMMAND_MAX_BUFFER_BYTES,
        }),
        dockerCommand: env.AGENT_CONTAINER_DOCKER_PATH,
        image: env.AGENT_CONTAINER_IMAGE,
        controlRoot:
          env.AGENT_RUNTIME_CONTROL_ROOT ?? resolve(env.WORKSPACE_ROOT, 'runtime-control'),
        cpuCount: env.AGENT_CONTAINER_CPU_COUNT,
        memoryBytes: env.AGENT_CONTAINER_MEMORY_MB * 1024 * 1024,
        pids: env.AGENT_CONTAINER_PIDS,
      })
    : new HostProcessExecutionRuntime({
        runner,
        disabled: env.NODE_ENV === 'production',
        healthEnv: env.CODEX_HOME ? { CODEX_HOME: env.CODEX_HOME } : undefined,
      });
};
