import { AgentRunStatus } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import { createAgentProcessor } from './agent.processor';

describe('agent cancellation processor', () => {
  it('calls the registered provider for a cancellation-claimed run', async () => {
    const cancelRun = vi.fn().mockResolvedValue(undefined);
    const cancelRuntime = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockReturnValue({ cancelRun });
    const processor = createAgentProcessor({
      prisma: {
        agentRun: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'agent-1',
            status: AgentRunStatus.CANCELLED,
            providerKey: 'codex',
          }),
        },
      },
      registry: { get },
      executionRuntime: { cancel: cancelRuntime },
    } as never);

    await expect(
      processor({ name: 'agent.run.cancel', data: { agentRunId: 'agent-1' } } as never),
    ).resolves.toEqual({ cancelled: true });
    expect(get).toHaveBeenCalledWith('codex');
    expect(cancelRun).toHaveBeenCalledWith('agent-1');
    expect(cancelRuntime).toHaveBeenCalledWith('agent-1');
  });

  it.each([
    { run: null, reason: 'missing' },
    {
      run: { id: 'agent-1', status: AgentRunStatus.SUCCEEDED, providerKey: 'codex' },
      reason: 'already SUCCEEDED',
    },
  ])('handles $reason idempotently', async ({ run, reason }) => {
    const get = vi.fn();
    const processor = createAgentProcessor({
      prisma: { agentRun: { findUnique: vi.fn().mockResolvedValue(run) } },
      registry: { get },
    } as never);

    await expect(
      processor({ name: 'agent.run.cancel', data: { agentRunId: 'agent-1' } } as never),
    ).resolves.toMatchObject({ cancelled: false, reason });
    expect(get).not.toHaveBeenCalled();
  });
});
