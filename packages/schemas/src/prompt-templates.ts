import { z } from 'zod';
import { AgentRole } from '@engloop/types';
import { ROLE_OUTPUT_SCHEMAS } from './agent-contracts';
import { cuidLike } from './common';

export const PROMPT_VARIABLES = [
  'task.title',
  'task.description',
  'task.objective',
  'task.acceptanceCriteria',
  'project.name',
  'project.objective',
  'phase.objective',
  'role',
] as const;
export type PromptVariable = (typeof PROMPT_VARIABLES)[number];

export const promptRoleSchema = z.enum([
  AgentRole.DOCUMENTATION,
  AgentRole.PLANNER,
  AgentRole.ARCHITECT,
  AgentRole.IMPLEMENTER,
  AgentRole.BACKEND_DEVELOPER,
  AgentRole.FRONTEND_DEVELOPER,
  AgentRole.DATABASE_ENGINEER,
  AgentRole.DEVOPS_ENGINEER,
  AgentRole.CODE_REVIEWER,
  AgentRole.SECURITY_REVIEWER,
  AgentRole.PERFORMANCE_REVIEWER,
  AgentRole.UI_REVIEWER,
]);
export type PromptRole = z.infer<typeof promptRoleSchema>;

/** Only literal text and allowlisted placeholders are accepted; there is no expression evaluator. */
export function promptVariables(body: string): PromptVariable[] {
  const variables = new Set<PromptVariable>();
  const remaining = body.replace(/\{\{\s*([a-zA-Z][a-zA-Z.]*)\s*\}\}/g, (_match, name: string) => {
    if (!PROMPT_VARIABLES.includes(name as PromptVariable))
      throw new Error(`Unsupported prompt variable: ${name}`);
    variables.add(name as PromptVariable);
    return '';
  });
  if (remaining.includes('{{') || remaining.includes('}}'))
    throw new Error('Malformed prompt placeholder');
  return [...variables];
}

export const promptBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(20000)
  .superRefine((body, ctx) => {
    try {
      promptVariables(body);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'Invalid prompt',
      });
    }
  });
export const createPromptTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: promptRoleSchema,
    body: promptBodySchema,
  })
  .strict();
export type CreatePromptTemplateDto = z.infer<typeof createPromptTemplateSchema>;
export const revisePromptTemplateSchema = z
  .object({
    expectedRevision: z.number().int().positive().max(2147483646),
    body: promptBodySchema,
  })
  .strict();
export type RevisePromptTemplateDto = z.infer<typeof revisePromptTemplateSchema>;
export const previewPromptSchema = z.object({ taskId: cuidLike }).strict();
export const promptRevisionNumberSchema = z.coerce.number().int().positive().max(2147483647);
export const validatePromptOutputSchema = z.object({ output: z.unknown() }).strict();

export function renderPrompt(
  body: string,
  context: Partial<Record<PromptVariable, string>>,
): string {
  promptBodySchema.parse(body);
  for (const name of promptVariables(body)) {
    // A blank value is as unresolved as a missing one: rendering it would hand the
    // agent a prompt with a hole where the operator expected content.
    const value = context[name];
    if (typeof value !== 'string' || value.trim() === '')
      throw new Error(`Unresolved prompt variable: ${name}`);
  }
  // Substituted values stay literal; placeholders in task text are never recursively expanded.
  const rendered = body.replace(
    /\{\{\s*([a-zA-Z][a-zA-Z.]*)\s*\}\}/g,
    (_match, name: string) => context[name as PromptVariable] ?? '',
  );
  if (rendered.length > 100000) throw new Error('Rendered prompt exceeds 100000 characters');
  return rendered;
}

/**
 * Render context from stored task/project/phase values. Missing, blank and empty
 * list values are left out, so a template that uses them fails as unresolved
 * instead of silently rendering an empty string.
 */
export function promptContext(input: {
  task: {
    title: string;
    description?: string | null;
    objective?: string | null;
    acceptanceCriteria?: readonly string[];
  };
  project: { name: string; contractObjective?: string | null };
  phase?: { objective?: string | null } | null;
  role: string;
}): Partial<Record<PromptVariable, string>> {
  const { task, project, phase, role } = input;
  const entries: [PromptVariable, string | null | undefined][] = [
    ['task.title', task.title],
    ['task.description', task.description],
    ['task.objective', task.objective],
    [
      'task.acceptanceCriteria',
      task.acceptanceCriteria && task.acceptanceCriteria.length > 0
        ? JSON.stringify(task.acceptanceCriteria)
        : null,
    ],
    ['project.name', project.name],
    ['project.objective', project.contractObjective],
    ['phase.objective', phase?.objective],
    ['role', role],
  ];
  return Object.fromEntries(
    entries.filter(
      (entry): entry is [PromptVariable, string] =>
        typeof entry[1] === 'string' && entry[1].trim() !== '',
    ),
  );
}

export function validatePromptOutput(role: PromptRole, output: unknown) {
  const encoded = JSON.stringify(output);
  if (!encoded || encoded.length > 200000)
    throw new Error('Output must be JSON of at most 200000 characters');
  return ROLE_OUTPUT_SCHEMAS[role].parse(output);
}
