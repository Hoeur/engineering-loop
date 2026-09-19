import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CommandRunner, RunCommandInput } from '@engloop/git';
import { AgentRole, type CommandResult } from '@engloop/types';
import { makeAgentTaskContext } from '@engloop/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentOutputInvalidError,
  AgentProviderRegistry,
  ClaudeCodeAgentProvider,
  claudeImplementerCommandRules,
  CodexAgentProvider,
  decodeClaudeOutput,
  decodeCodexOutput,
} from '../src';

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), 'engloop-provider-test-'));
  temporaryDirectories.push(path);
  return path;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const validPlan = {
  summary: 'Implement the requested change',
  approach: 'Make a focused change and verify it',
  risks: [],
  tasks: [
    {
      title: 'Implement change',
      objective: 'Complete the requested behavior',
      description: '',
      type: 'FEATURE',
      priority: 'MEDIUM',
      riskLevel: 'MEDIUM',
      acceptanceCriteria: [],
      implementationNotes: [],
      suggestedFiles: [],
      requiredChecks: [],
      dependsOn: [],
    },
  ],
  acceptanceCriteria: [],
  requiredChecks: [],
  dependencies: [],
  architectureNotes: [],
  openQuestions: [],
};

const commandResult = (input: RunCommandInput, stdout: string, stderr = ''): CommandResult => ({
  command: input.command,
  args: [...input.args],
  cwd: input.cwd,
  exitCode: 0,
  signal: null,
  stdout,
  stderr,
  truncated: false,
  timedOut: false,
  startedAt: new Date(0).toISOString(),
  completedAt: new Date(1).toISOString(),
  durationMs: 1,
});

const fakeRunner = (run: (input: RunCommandInput) => Promise<CommandResult>): CommandRunner =>
  ({
    isAllowed: vi.fn(() => true),
    run: vi.fn(run),
  }) as unknown as CommandRunner;

describe('CodexAgentProvider', () => {
  it('decodes JSONL session, usage, and final assistant output', async () => {
    const outputFile = join(await makeTemporaryDirectory(), 'missing-output.json');
    const stdout = [
      { type: 'thread.started', thread_id: 'thread-codex-1' },
      {
        type: 'item.completed',
        item: { type: 'agent_message', text: JSON.stringify(validPlan) },
      },
      {
        type: 'turn.completed',
        usage: { input_tokens: 120, cached_input_tokens: 40, output_tokens: 30 },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');

    const decoded = await decodeCodexOutput({ stdout, stderr: '', outputFile });

    expect(decoded.output).toEqual(validPlan);
    expect(decoded.sessionId).toBe('thread-codex-1');
    expect(decoded.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cachedTokens: 40,
      totalTokens: 150,
    });
  });

  it('passes the request on stdin and enforces sandbox and schema flags', async () => {
    const workspacePath = await makeTemporaryDirectory();
    let request = '';
    let schemaFile = '';
    let schema = '';
    let outputFile = '';
    let temporaryFiles: string[] = [];
    const runner = fakeRunner(async (input) => {
      request = input.stdin ?? '';
      const schemaIndex = input.args.indexOf('--output-schema');
      schemaFile = input.args[schemaIndex + 1] ?? '';
      schema = await readFile(schemaFile, 'utf8');
      const outputIndex = input.args.indexOf('--output-last-message');
      outputFile = input.args[outputIndex + 1] ?? '';
      temporaryFiles = await readdir(dirname(schemaFile));
      await writeFile(outputFile, JSON.stringify(validPlan), 'utf8');
      const stdout = [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-from-run' }),
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      ].join('\n');
      return commandResult(input, stdout);
    });
    const provider = new CodexAgentProvider({
      cliPath: 'node',
      cliArgsPrefix: ['codex-entry.js'],
      model: 'gpt-test',
      runner,
    });

    const result = await provider.startRun(
      makeAgentTaskContext({ role: AgentRole.PLANNER, workspacePath }),
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.output).toEqual(validPlan);
    expect(result.sessionId).toBe('thread-from-run');
    expect(vi.mocked(runner.run).mock.calls[0]?.[0].args.slice(0, 2)).toEqual([
      'codex-entry.js',
      'exec',
    ]);
    const args = vi.mocked(runner.run).mock.calls[0]?.[0].args ?? [];
    expect(args).toEqual(expect.arrayContaining(['--ignore-user-config', '--output-schema']));
    expect(args).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write']));
    expect(args.at(-1)).toBe('-');
    const parsedRequest = JSON.parse(request) as Record<string, unknown>;
    const parsedSchema = JSON.parse(schema) as Record<string, unknown>;
    expect(parsedRequest['role']).toBe(AgentRole.PLANNER);
    expect(parsedRequest['responseSchema']).toEqual(parsedSchema);
    expect(parsedSchema['type']).toBe('object');
    expect(parsedSchema['properties']).toEqual(
      expect.objectContaining({ summary: expect.any(Object), tasks: expect.any(Object) }),
    );
    const properties = parsedSchema['properties'] as Record<string, unknown>;
    const tasks = properties['tasks'] as Record<string, unknown>;
    const taskItems = tasks['items'] as Record<string, unknown>;
    const taskProperties = taskItems['properties'] as Record<string, unknown>;
    expect(taskItems['required']).toEqual(Object.keys(taskProperties));
    expect(temporaryFiles.sort()).toEqual(['output.json', 'response-schema.json']);
    expect(await readdir(workspacePath)).toEqual([]);
    expect(schemaFile.startsWith(workspacePath)).toBe(false);
    await expect(access(schemaFile)).rejects.toThrow();
    await expect(access(outputFile)).rejects.toThrow();
  });

  it('rejects malformed JSONL transport output', async () => {
    const workspacePath = await makeTemporaryDirectory();
    const runner = fakeRunner(async (input) => commandResult(input, 'not-json'));
    const provider = new CodexAgentProvider({ cliPath: 'codex', model: 'gpt-test', runner });

    await expect(
      provider.startRun(makeAgentTaskContext({ role: AgentRole.PLANNER, workspacePath })),
    ).rejects.toBeInstanceOf(AgentOutputInvalidError);
  });

  it('does not accept successful output that exceeds the run budget', async () => {
    const workspacePath = await makeTemporaryDirectory();
    const runner = fakeRunner(async (input) => {
      const outputIndex = input.args.indexOf('--output-last-message');
      await writeFile(input.args[outputIndex + 1] ?? '', JSON.stringify(validPlan), 'utf8');
      return commandResult(
        input,
        [
          JSON.stringify({ type: 'thread.started', thread_id: 'budget-thread' }),
          JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }),
        ].join('\n'),
      );
    });
    const provider = new CodexAgentProvider({ cliPath: 'codex', model: 'gpt-test', runner });
    const base = makeAgentTaskContext({ role: AgentRole.PLANNER, workspacePath });
    const result = await provider.startRun({
      ...base,
      budget: { ...base.budget, maxTokens: 5 },
    });

    expect(result.status).toBe('BUDGET_EXCEEDED');
    expect(result.output).toBeNull();
    expect(result.error?.code).toBe('AGENT_BUDGET_EXCEEDED');
  });
});

describe('ClaudeCodeAgentProvider', () => {
  it('decodes structured output, session, usage, cache tokens, and exact cost', () => {
    const decoded = decodeClaudeOutput({
      stdout: JSON.stringify({
        type: 'result',
        is_error: false,
        structured_output: validPlan,
        session_id: 'session-claude-1',
        total_cost_usd: 0.042,
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
          output_tokens: 40,
        },
      }),
      stderr: '',
      outputFile: '',
    });

    expect(decoded.output).toEqual(validPlan);
    expect(decoded.sessionId).toBe('session-claude-1');
    expect(decoded.usage).toEqual({
      inputTokens: 150,
      outputTokens: 40,
      cachedTokens: 30,
      totalTokens: 190,
    });
    expect(decoded.estimatedCostUsd).toBe(0.042);
  });

  it('extracts JSON from the result string and validates the role payload', async () => {
    const workspacePath = await makeTemporaryDirectory();
    let request = '';
    let schemaJson = '';
    const runner = fakeRunner(async (input) => {
      request = input.stdin ?? '';
      const schemaIndex = input.args.indexOf('--json-schema');
      schemaJson = input.args[schemaIndex + 1] ?? '';
      return commandResult(
        input,
        JSON.stringify({
          type: 'result',
          result: `Completed successfully\n${JSON.stringify(validPlan)}`,
          session_id: 'session-from-run',
          usage: { input_tokens: 7, output_tokens: 3 },
        }),
      );
    });
    const provider = new ClaudeCodeAgentProvider({
      cliPath: 'claude',
      model: 'claude-test',
      runner,
    });

    const result = await provider.startRun(
      makeAgentTaskContext({ role: AgentRole.PLANNER, workspacePath }),
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.output).toEqual(validPlan);
    expect(result.sessionId).toBe('session-from-run');
    expect(result.usage.totalTokens).toBe(10);
    const args = vi.mocked(runner.run).mock.calls[0]?.[0].args ?? [];
    expect(args).toEqual(
      expect.arrayContaining(['-p', '--output-format', 'json', '--json-schema']),
    );
    expect(args).not.toContain(request);
    const parsedRequest = JSON.parse(request) as Record<string, unknown>;
    expect(parsedRequest['responseSchema']).toEqual(JSON.parse(schemaJson));
    expect(await readdir(workspacePath)).toEqual([]);
  });

  it('keeps planning and review roles read-only', async () => {
    const workspacePath = await makeTemporaryDirectory();
    const runner = fakeRunner(async (input) =>
      commandResult(input, JSON.stringify({ type: 'result', structured_output: validPlan })),
    );
    const provider = new ClaudeCodeAgentProvider({
      cliPath: 'claude',
      model: 'claude-test',
      runner,
    });

    await provider.startRun(makeAgentTaskContext({ role: AgentRole.PLANNER, workspacePath }));

    const args = vi.mocked(runner.run).mock.calls[0]?.[0].args ?? [];
    const denied = args.slice(
      args.indexOf('--disallowedTools') + 1,
      args.indexOf('--output-format'),
    );
    expect(denied).toEqual(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash']);
    expect(args).not.toContain('--permission-mode');
    expect(args).not.toContain('--allowedTools');
  });

  it('lets implementers edit their worktree and run only check and read-only git commands', async () => {
    const workspacePath = await makeTemporaryDirectory();
    const runner = fakeRunner(async (input) =>
      commandResult(input, JSON.stringify({ type: 'result', structured_output: {} })),
    );
    const provider = new ClaudeCodeAgentProvider({
      cliPath: 'claude',
      model: 'claude-test',
      runner,
    });

    await provider
      .startRun(makeAgentTaskContext({ role: AgentRole.IMPLEMENTER, workspacePath }))
      .catch(() => undefined); // the empty payload fails the role schema; only argv matters here

    const args = vi.mocked(runner.run).mock.calls[0]?.[0].args ?? [];
    expect(args).toEqual(expect.arrayContaining(['--permission-mode', 'acceptEdits']));
    const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--output-format'));
    expect(allowed).toEqual(
      expect.arrayContaining([
        'Bash(git diff:*)',
        'Bash(pnpm install --frozen-lockfile:*)',
        'Bash(pnpm run lint:*)',
      ]),
    );
    expect(allowed.join(' ')).not.toMatch(/commit|push|add |install [^-]/);
    expect(args).not.toContain('--disallowedTools');
  });

  it('derives command rules from the repository package manager', () => {
    expect(claudeImplementerCommandRules('npm')).toEqual(
      expect.arrayContaining(['Bash(npm ci:*)', 'Bash(npm test:*)', 'Bash(npm run typecheck:*)']),
    );
    expect(claudeImplementerCommandRules('something-else')).toContain('Bash(npm ci:*)');
    expect(claudeImplementerCommandRules(null)).toContain('Bash(npm run build:*)');
  });

  it('serves every mandatory workflow role', () => {
    const registry = new AgentProviderRegistry().register(
      new ClaudeCodeAgentProvider({
        cliPath: 'claude',
        model: 'claude-test',
        runner: fakeRunner(async (input) => commandResult(input, '')),
      }),
    );
    for (const role of [
      AgentRole.ARCHITECT,
      AgentRole.PLANNER,
      AgentRole.IMPLEMENTER,
      AgentRole.CODE_REVIEWER,
    ]) {
      expect(registry.resolve({ role, fallbackProviderKey: 'claude-code' }).key).toBe(
        'claude-code',
      );
    }
  });

  it('rejects malformed JSON transport output', async () => {
    const workspacePath = await makeTemporaryDirectory();
    const runner = fakeRunner(async (input) => commandResult(input, '{bad json'));
    const provider = new ClaudeCodeAgentProvider({
      cliPath: 'claude',
      model: 'claude-test',
      runner,
    });

    await expect(
      provider.startRun(makeAgentTaskContext({ role: AgentRole.PLANNER, workspacePath })),
    ).rejects.toBeInstanceOf(AgentOutputInvalidError);
  });

  it('rejects a decoded payload that does not match the requested role schema', async () => {
    const workspacePath = await makeTemporaryDirectory();
    const runner = fakeRunner(async (input) =>
      commandResult(
        input,
        JSON.stringify({ type: 'result', structured_output: { summary: 'missing plan fields' } }),
      ),
    );
    const provider = new ClaudeCodeAgentProvider({
      cliPath: 'claude',
      model: 'claude-test',
      runner,
    });

    await expect(
      provider.startRun(makeAgentTaskContext({ role: AgentRole.PLANNER, workspacePath })),
    ).rejects.toBeInstanceOf(AgentOutputInvalidError);
  });
});
