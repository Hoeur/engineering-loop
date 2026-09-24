import { readFile } from 'node:fs/promises';
import { extractJson } from '@engloop/schemas';
import { AgentProviderKind, AgentRole } from '@engloop/types';
import { z } from 'zod';
import {
  CliCodingAgentProvider,
  type CliAgentOptions,
  type CliDecodedOutput,
  type CliDecodeInput,
} from './cli-agent';

export interface CodexProviderOptions
  extends Omit<
    CliAgentOptions,
    'key' | 'name' | 'buildArgs' | 'buildResumeArgs' | 'decodeOutput' | 'capabilities'
  > {
  key?: string;
  name?: string;
}

const codexEventSchema = z.object({ type: z.string() }).passthrough();
const codexUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    cached_input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();
const codexAgentMessageSchema = z.object({
  type: z.literal('agent_message'),
  text: z.string(),
});

const readOptionalOutput = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : null;
    if (code === 'ENOENT') return '';
    throw error;
  }
};

/** Decode Codex JSONL without confusing transport events for role output. */
export const decodeCodexOutput = async (input: CliDecodeInput): Promise<CliDecodedOutput> => {
  const events = input.stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`Codex JSONL line ${String(index + 1)} is not valid JSON`);
      }
      const parsed = codexEventSchema.safeParse(value);
      if (!parsed.success) {
        throw new Error(`Codex JSONL line ${String(index + 1)} is not a valid event`);
      }
      return parsed.data;
    });

  let sessionId: string | null = null;
  let message: string | null = null;
  let usage: CliDecodedOutput['usage'];

  for (const event of events) {
    if (event.type === 'thread.started') {
      const threadId = event['thread_id'];
      if (typeof threadId === 'string' && threadId.length > 0) sessionId = threadId;
    }
    if (event.type === 'item.completed') {
      const item = codexAgentMessageSchema.safeParse(event['item']);
      if (item.success) message = item.data.text;
    }
    if (event.type === 'turn.completed') {
      const parsedUsage = codexUsageSchema.safeParse(event['usage']);
      if (parsedUsage.success) {
        const inputTokens = parsedUsage.data.input_tokens ?? 0;
        const outputTokens = parsedUsage.data.output_tokens ?? 0;
        usage = {
          inputTokens,
          outputTokens,
          cachedTokens: parsedUsage.data.cached_input_tokens ?? 0,
          totalTokens: inputTokens + outputTokens,
        };
      }
    }
  }

  const outputFile = (await readOptionalOutput(input.outputFile)).trim();
  const finalOutput = outputFile || message;
  if (!finalOutput) throw new Error('Codex did not emit a final assistant message');

  return { output: extractJson(finalOutput), sessionId, usage };
};

export class CodexAgentProvider extends CliCodingAgentProvider {
  constructor(options: CodexProviderOptions) {
    super(AgentProviderKind.CODEX, {
      ...options,
      key: options.key ?? 'codex',
      name: options.name ?? 'Codex',
      healthArgs: ['--version'],
      buildArgs: (context, schemaFile, outputFile) => [
        'exec',
        '--ignore-user-config',
        '--sandbox',
        'workspace-write',
        '--model',
        options.model,
        '--cd',
        context.workspacePath,
        '--output-schema',
        schemaFile,
        '--json',
        '--output-last-message',
        outputFile,
        '-',
      ],
      buildResumeArgs: (sessionId, _context, schemaFile, outputFile) => [
        'exec',
        '--ignore-user-config',
        '--sandbox',
        'workspace-write',
        '--model',
        options.model,
        '--output-schema',
        schemaFile,
        '--json',
        '--output-last-message',
        outputFile,
        'resume',
        sessionId,
        '-',
      ],
      decodeOutput: decodeCodexOutput,
      capabilities: {
        roles: [
          AgentRole.PLANNER,
          AgentRole.ARCHITECT,
          AgentRole.CODE_REVIEWER,
          AgentRole.SECURITY_REVIEWER,
          AgentRole.PERFORMANCE_REVIEWER,
          AgentRole.IMPLEMENTER,
          AgentRole.DOCUMENTATION,
        ],
        resumable: true,
        executesCommands: true,
        commits: false,
      },
    });
  }
}
