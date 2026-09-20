import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRole } from '@engloop/types';
import {
  documentationOutputSchema,
  parseSafely,
  plannerOutputSchema,
  implementationOutputSchema,
  reviewOutputSchema,
} from '@engloop/schemas';
import { makeAgentTaskContext } from '@engloop/testing';
import {
  AgentProviderRegistry,
  ClaudeCodeAgentProvider,
  CodexAgentProvider,
  MockAgentProvider,
  estimateCostUsd,
} from '../src';

const provider = new MockAgentProvider({ latencyMs: 0 });

describe('MockAgentProvider', () => {
  it('is always healthy and needs no credentials', async () => {
    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
  });

  it('produces a schema-valid plan with three tasks', async () => {
    const result = await provider.startRun(
      makeAgentTaskContext({
        role: AgentRole.PLANNER,
        input: { requirement: 'Implement organization invitations' },
      }),
    );
    expect(result.status).toBe('SUCCEEDED');
    const parsed = parseSafely(plannerOutputSchema, result.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.tasks).toHaveLength(3);
  });

  it('produces a schema-valid implementation result', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'engloop-mock-provider-'));
    try {
      const result = await provider.startRun(
        makeAgentTaskContext({
          role: AgentRole.IMPLEMENTER,
          workspacePath,
          input: {
            taskId: 't1',
            taskKey: 'ENG-101',
            title: 'Do the thing',
            objective: 'Do it',
          },
        }),
      );
      const parsed = parseSafely(implementationOutputSchema, result.output);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.data.status).toBe('implementation_complete');
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it('requests changes on the first review cycle, then approves', async () => {
    const first = await provider.startRun(
      makeAgentTaskContext({
        role: AgentRole.CODE_REVIEWER,
        input: { taskId: 't1', taskKey: 'ENG-101', title: 't', objective: 'o', cycle: 1 },
      }),
    );
    const firstParsed = parseSafely(reviewOutputSchema, first.output);
    expect(firstParsed.ok).toBe(true);
    if (firstParsed.ok) {
      expect(firstParsed.data.decision).toBe('changes_requested');
      expect(firstParsed.data.findings.length).toBeGreaterThan(0);
    }

    const second = await provider.startRun(
      makeAgentTaskContext({
        role: AgentRole.CODE_REVIEWER,
        input: { taskId: 't1', taskKey: 'ENG-101', title: 't', objective: 'o', cycle: 2 },
      }),
    );
    const secondParsed = parseSafely(reviewOutputSchema, second.output);
    expect(secondParsed.ok).toBe(true);
    if (secondParsed.ok) {
      expect(secondParsed.data.decision).toBe('approved');
      expect(secondParsed.data.findings).toHaveLength(0);
    }
  });

  it('is deterministic: the same run id yields the same usage', async () => {
    const context = makeAgentTaskContext({ role: AgentRole.PLANNER });
    const a = await provider.startRun(context);
    const b = await provider.startRun(context);
    expect(a.usage).toEqual(b.usage);
  });

  it('simulates failure when a failure rate is configured', async () => {
    const flaky = new MockAgentProvider({ latencyMs: 0, failureRate: 1 });
    const result = await flaky.startRun(makeAgentTaskContext({ role: AgentRole.PLANNER }));
    expect(result.status).toBe('FAILED');
    expect(result.error?.retriable).toBe(true);
  });

  it('honours cancellation', async () => {
    const context = makeAgentTaskContext({ role: AgentRole.PLANNER });
    await provider.cancelRun(context.runId);
    const result = await provider.startRun(context);
    expect(result.status).toBe('CANCELLED');
  });
});

describe('DOCUMENTATION role support', () => {
  it('produces schema-valid documentation output', async () => {
    const result = await provider.startRun(
      makeAgentTaskContext({
        role: AgentRole.DOCUMENTATION,
        input: {
          taskId: 'task-1',
          requirement: 'Add a health endpoint',
          constraints: [],
          implementationSummary: 'Added GET /health',
          plannerSummary: null,
        },
      }),
    );

    expect(result.status).toBe('SUCCEEDED');
    const parsed = parseSafely(documentationOutputSchema, result.output, 'documentation output');
    expect(parsed.ok).toBe(true);
  });

  // The registry refuses a role a provider does not declare, so a workflow step
  // for a role missing from these lists fails every single run. Adding the step
  // without the capability is exactly the bug this asserts against.
  it.each([
    ['codex', () => new CodexAgentProvider({ cliPath: 'codex', model: 'gpt-test' })],
    ['claude-code', () => new ClaudeCodeAgentProvider({ cliPath: 'claude', model: 'claude-test' })],
  ])('is declared by the %s provider', (_label, build) => {
    expect(build().capabilities.roles).toContain(AgentRole.DOCUMENTATION);
  });
});

describe('AgentProviderRegistry', () => {
  it('resolves the first explicitly configured provider', () => {
    const registry = new AgentProviderRegistry().register(provider);
    expect(registry.resolve({ role: AgentRole.PLANNER, fallbackProviderKey: 'mock' }).key).toBe(
      'mock',
    );
    expect(() =>
      registry.resolve({
        role: AgentRole.PLANNER,
        overrides: { PLANNER: 'nope' },
        fallbackProviderKey: 'mock',
      }),
    ).toThrow(/nope.*unavailable/i);
  });

  it('throws a typed error when nothing can serve the role', () => {
    const empty = new AgentProviderRegistry();
    expect(() => empty.resolve({ role: AgentRole.PLANNER })).toThrow(/unavailable/i);
  });

  it('health-checks every registered provider', async () => {
    const registry = new AgentProviderRegistry().register(provider);
    const health = await registry.healthCheckAll();
    expect(health.mock?.healthy).toBe(true);
  });
});

describe('cost estimation', () => {
  it('prices tokens per million and rounds to six decimals', () => {
    const cost = estimateCostUsd(
      { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 0, totalTokens: 2_000_000 },
      'claude-opus-5',
    );
    expect(cost).toBe(30);
  });

  it('falls back to default pricing for an unknown model', () => {
    const cost = estimateCostUsd(
      { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0, totalTokens: 1_000_000 },
      'some-new-model',
    );
    expect(cost).toBeGreaterThan(0);
  });

  it('charges nothing for the mock provider', () => {
    expect(
      estimateCostUsd(
        { inputTokens: 5_000, outputTokens: 5_000, cachedTokens: 0, totalTokens: 10_000 },
        'mock',
      ),
    ).toBe(0);
  });
});
