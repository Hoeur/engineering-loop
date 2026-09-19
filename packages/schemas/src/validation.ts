import { type z } from 'zod';

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

export class SchemaValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(subject: string, issues: ValidationIssue[]) {
    super(
      `${subject} failed validation:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`,
    );
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}

export const toIssues = (error: z.ZodError): ValidationIssue[] =>
  error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));

/**
 * Strict parse used at every trust boundary — HTTP input and, critically, raw AI
 * output. Never trust an agent's JSON: it goes through here or it is rejected.
 */
export const parseOrThrow = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  subject = 'payload',
): z.infer<TSchema> => {
  const result = schema.safeParse(value);
  if (!result.success) throw new SchemaValidationError(subject, toIssues(result.error));
  return result.data;
};

export type SafeParseOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; issues: ValidationIssue[]; error: SchemaValidationError };

export const parseSafely = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  subject = 'payload',
): SafeParseOutcome<z.infer<TSchema>> => {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  const issues = toIssues(result.error);
  return { ok: false, issues, error: new SchemaValidationError(subject, issues) };
};

/**
 * Extracts the first JSON object/array from a text blob.
 *
 * CLI-based coding agents wrap their structured answer in prose or fences; this
 * finds the payload without ever `eval`-ing model output.
 */
export const extractJson = (raw: string): unknown => {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = [fenced?.[1], trimmed].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const text = candidate.trim();
    try {
      return JSON.parse(text);
    } catch {
      const start = text.search(/[[{]/);
      if (start === -1) continue;
      const opener = text[start];
      const closer = opener === '{' ? '}' : ']';
      const end = text.lastIndexOf(closer);
      if (end <= start) continue;
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        continue;
      }
    }
  }
  throw new SchemaValidationError('agent output', [
    { path: '(root)', message: 'No parsable JSON payload found in agent output', code: 'custom' },
  ]);
};
