export type Nullable<T> = T | null;
export type Maybe<T> = T | null | undefined;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface TimeRange {
  from: string;
  to: string;
}

export interface CommandDescriptor {
  /** Executable name; must pass the runner allowlist. */
  command: string;
  /** Arguments passed as an array — never string-concatenated into a shell. */
  args: string[];
  /** Optional human label used in the UI, e.g. "pnpm typecheck". */
  label?: string;
}

export interface CommandResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export const EMPTY_TOKEN_USAGE: TokenUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
});
