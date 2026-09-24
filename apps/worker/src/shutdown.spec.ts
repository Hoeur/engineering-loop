import { describe, expect, it, vi } from 'vitest';
import { onceAsync, registerShutdownSignals, stopWorkerExecution } from './shutdown';

describe('stopWorkerExecution', () => {
  it('pauses every worker before runtime shutdown, then closes workers and the queue', async () => {
    const calls: string[] = [];
    const lifecycle = (name: string) => ({
      pause: vi.fn(async () => {
        calls.push(`pause:${name}`);
      }),
      close: vi.fn(async () => {
        calls.push(`close:${name}`);
      }),
    });
    const first = lifecycle('first');
    const second = lifecycle('second');
    const executionRuntime = {
      shutdown: vi.fn(async () => {
        calls.push('runtime:shutdown');
      }),
    };
    const workflowQueue = {
      close: vi.fn(async () => {
        calls.push('queue:close');
      }),
    };

    await stopWorkerExecution({
      workers: [first, second],
      executionRuntime: executionRuntime as never,
      workflowQueue,
    });

    expect(first.pause).toHaveBeenCalledWith(true);
    expect(second.pause).toHaveBeenCalledWith(true);
    expect(calls).toEqual([
      'pause:first',
      'pause:second',
      'runtime:shutdown',
      'close:first',
      'close:second',
      'queue:close',
    ]);
  });

  it('runs an async shutdown operation only once', async () => {
    const operation = vi.fn(async (_signal: string) => undefined);
    const shutdown = onceAsync(operation);

    const first = shutdown('SIGTERM');
    const second = shutdown('SIGINT');

    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(operation).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledWith('SIGTERM');
  });

  it('owns termination immediately after registration and preserves cleanup ordering', async () => {
    const listeners = new Map<string, () => void>();
    const source = {
      on: vi.fn((signal: string, listener: () => void) => {
        listeners.set(signal, listener);
      }),
    };
    const calls: string[] = [];
    const worker = {
      pause: vi.fn(async () => {
        calls.push('worker:pause');
      }),
      close: vi.fn(async () => {
        calls.push('worker:close');
      }),
    };
    const executionRuntime = {
      shutdown: vi.fn(async () => {
        calls.push('runtime:shutdown');
      }),
    };
    const workflowQueue = {
      close: vi.fn(async () => {
        calls.push('queue:close');
      }),
    };
    const operation = vi.fn(async () => {
      await stopWorkerExecution({
        workers: [worker],
        executionRuntime: executionRuntime as never,
        workflowQueue,
      });
    });

    const shutdown = registerShutdownSignals(source, operation);
    listeners.get('SIGTERM')?.();
    listeners.get('SIGINT')?.();
    await shutdown('SIGINT');

    expect(source.on).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledWith('SIGTERM');
    expect(calls).toEqual([
      'worker:pause',
      'runtime:shutdown',
      'worker:close',
      'queue:close',
    ]);
  });
});
