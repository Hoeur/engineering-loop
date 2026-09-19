export class CommandNotAllowedError extends Error {
  constructor(public readonly command: string) {
    super(`Command "${command}" is not in the allowlist`);
    this.name = 'CommandNotAllowedError';
  }
}

export class CommandFailedError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
    public readonly stdout: string,
  ) {
    super(message);
    this.name = 'CommandFailedError';
  }
}

export class CommandTimeoutError extends Error {
  constructor(
    public readonly command: string,
    public readonly timeoutMs: number,
  ) {
    super(`Command "${command}" exceeded its ${timeoutMs}ms timeout`);
    this.name = 'CommandTimeoutError';
  }
}

export class GitOperationError extends Error {
  constructor(
    public readonly operation: string,
    message: string,
    public readonly stderr?: string,
  ) {
    super(`git ${operation} failed: ${message}`);
    this.name = 'GitOperationError';
  }
}

export class WorktreeConflictError extends Error {
  constructor(public readonly path: string) {
    super(`A worktree already exists at ${path}`);
    this.name = 'WorktreeConflictError';
  }
}
