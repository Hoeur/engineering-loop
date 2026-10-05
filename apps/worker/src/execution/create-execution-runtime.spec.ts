import { parseEnv } from '@engloop/config';
import { describe, expect, it } from 'vitest';
import { configuredProviderCommand, createAgentExecutionRuntime } from './create-execution-runtime';
import { DockerContainerExecutionRuntime } from './docker-container-execution-runtime';
import { HostProcessExecutionRuntime } from './host-process-execution-runtime';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  AUTH_JWT_SECRET: 'a-secret-that-is-long-enough',
  SECRETS_ENCRYPTION_KEY: 'another-long-enough-secret-value',
};

describe('createAgentExecutionRuntime', () => {
  it('rejects production host CLI execution at worker composition', () => {
    expect(() =>
      createAgentExecutionRuntime(parseEnv({ ...base, NODE_ENV: 'production' }), {} as never),
    ).toThrow('Production CLI execution requires DOCKER');
  });

  it('permits production mock boot but prevents later host CLI execution', async () => {
    const runtime = createAgentExecutionRuntime(
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        AGENT_ENABLE_MOCK: 'true',
        AGENT_DEFAULT_PROVIDER: 'mock',
      }),
      {} as never,
    );
    expect(runtime.isAllowed('codex')).toBe(false);
    await expect(
      runtime.prepare({
        runId: 'run',
        workspacePath: '.',
        limits: { timeoutMs: 1000, allowedCommands: ['codex'] },
        secretEnv: {},
        credentialSource: 'cli-login',
      }),
    ).rejects.toThrow('Production CLI execution requires DOCKER');
  });
  it('keeps host mode available for local development', () => {
    const runtime = createAgentExecutionRuntime(parseEnv(base), {} as never);

    expect(runtime).toBeInstanceOf(HostProcessExecutionRuntime);
  });

  it('selects Docker only from the validated runtime setting', () => {
    const env = parseEnv({
      ...base,
      AGENT_EXECUTION_RUNTIME: 'DOCKER',
      AGENT_RUNTIME_CONTROL_ROOT: 'C:/engloop/runtime-control',
    });
    const runtime = createAgentExecutionRuntime(env, {} as never);

    expect(runtime).toBeInstanceOf(DockerContainerExecutionRuntime);
  });

  it('uses container command names instead of host executable paths in Docker mode', () => {
    const env = parseEnv({
      ...base,
      AGENT_EXECUTION_RUNTIME: 'DOCKER',
      CODEX_CLI_PATH: 'C:/host/bin/codex.exe',
      CLAUDE_CODE_CLI_PATH: 'C:/host/bin/claude.exe',
      AGENT_CONTAINER_CODEX_CLI_PATH: '/usr/local/bin/codex',
      AGENT_CONTAINER_CLAUDE_CODE_CLI_PATH: '/usr/local/bin/claude',
    });

    expect(configuredProviderCommand(env, 'CODEX')).toBe('/usr/local/bin/codex');
    expect(configuredProviderCommand(env, 'CLAUDE_CODE')).toBe('/usr/local/bin/claude');
  });
});
