import { randomUUID } from 'node:crypto';
import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';
import type { ExecutionContext, PartialExecutionContext } from '@engloop/types';
import { REDACTED_PATHS } from './redact';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface LoggerConfig {
  level?: LogLevel;
  pretty?: boolean;
  service: string;
  version?: string;
  base?: Record<string, unknown>;
}

export interface EngLoopLogger {
  fatal(payload: object | string, message?: string): void;
  error(payload: object | string, message?: string): void;
  warn(payload: object | string, message?: string): void;
  info(payload: object | string, message?: string): void;
  debug(payload: object | string, message?: string): void;
  trace(payload: object | string, message?: string): void;
  /** Returns a child logger that stamps every line with the given correlation ids. */
  withContext(context: PartialExecutionContext): EngLoopLogger;
  child(bindings: Record<string, unknown>): EngLoopLogger;
  readonly raw: PinoLogger;
}

const wrap = (instance: PinoLogger): EngLoopLogger => ({
  fatal: (payload, message) => instance.fatal(payload as object, message),
  error: (payload, message) => instance.error(payload as object, message),
  warn: (payload, message) => instance.warn(payload as object, message),
  info: (payload, message) => instance.info(payload as object, message),
  debug: (payload, message) => instance.debug(payload as object, message),
  trace: (payload, message) => instance.trace(payload as object, message),
  withContext: (context) => wrap(instance.child(compactContext(context))),
  child: (bindings) => wrap(instance.child(bindings)),
  raw: instance,
});

const compactContext = (context: PartialExecutionContext): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
};

export const createLogger = (config: LoggerConfig): EngLoopLogger => {
  const options: LoggerOptions = {
    level: config.level ?? 'info',
    base: { service: config.service, version: config.version ?? '0.1.0', ...config.base },
    redact: { paths: [...REDACTED_PATHS], censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (config.pretty) {
    return wrap(
      pino({
        ...options,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, singleLine: false, translateTime: 'HH:MM:ss.l' },
        },
      }),
    );
  }
  return wrap(pino(options));
};

/** Creates a fresh correlation context, generating ids that are missing. */
export const createExecutionContext = (seed: PartialExecutionContext = {}): ExecutionContext => ({
  traceId: seed.traceId ?? randomUUID(),
  ...compactContext(seed),
});

/** No-op logger for unit tests and library defaults. */
export const silentLogger: EngLoopLogger = createLogger({ service: 'silent', level: 'silent' });
