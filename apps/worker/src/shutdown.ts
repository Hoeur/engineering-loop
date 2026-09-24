import type { AgentExecutionRuntime } from './execution';

interface WorkerLifecycle {
  pause(doNotWaitActive?: boolean): Promise<void>;
  close(): Promise<void>;
}

interface QueueLifecycle {
  close(): Promise<void>;
}

export type WorkerShutdownSignal = 'SIGTERM' | 'SIGINT';

interface ShutdownSignalSource {
  on(signal: WorkerShutdownSignal, listener: () => void): unknown;
}

export interface StopWorkerExecutionInput {
  workers: readonly WorkerLifecycle[];
  executionRuntime: AgentExecutionRuntime;
  workflowQueue: QueueLifecycle;
}

export const onceAsync = <TArg>(operation: (argument: TArg) => Promise<void>) => {
  let active: Promise<void> | null = null;
  return (argument: TArg): Promise<void> => {
    active ??= operation(argument);
    return active;
  };
};

export const registerShutdownSignals = (
  source: ShutdownSignalSource,
  operation: (signal: WorkerShutdownSignal) => Promise<void>,
): ((signal: WorkerShutdownSignal) => Promise<void>) => {
  const shutdown = onceAsync(operation);
  source.on('SIGTERM', () => void shutdown('SIGTERM'));
  source.on('SIGINT', () => void shutdown('SIGINT'));
  return shutdown;
};

/** Stop queue intake before aborting execution sessions, then close queue resources. */
export const stopWorkerExecution = async (input: StopWorkerExecutionInput): Promise<void> => {
  await Promise.all(input.workers.map((worker) => worker.pause(true)));
  await input.executionRuntime.shutdown();
  await Promise.all(input.workers.map((worker) => worker.close()));
  await input.workflowQueue.close();
};
