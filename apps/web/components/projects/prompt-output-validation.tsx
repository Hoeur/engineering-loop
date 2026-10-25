'use client';

import * as React from 'react';
import type { AgentRole } from '@engloop/types';
import { PROMPT_OUTPUT_MAX_CHARS, promptOutputIssuesSchema } from '@engloop/schemas';
import { Button } from '@engloop/ui';
import { ApiError } from '@/lib/api-client';
import { useValidatePromptOutput } from '@/lib/project-prompts';

export function PromptOutputValidation({
  projectId,
  templateId,
  revision,
  role,
}: {
  projectId: string;
  templateId: string;
  revision: number;
  role: AgentRole;
}) {
  const [text, setText] = React.useState('');
  const [parseError, setParseError] = React.useState<string | null>(null);
  const validation = useValidatePromptOutput(projectId, templateId, revision);
  const issues = promptOutputIssuesSchema.safeParse(
    validation.error instanceof ApiError ? validation.error.details?.issues : undefined,
  );
  const id = React.useId();
  const error = parseError ?? (validation.isError ? validation.error.message : null);

  return (
    <section aria-label="Output contract validation" className="min-w-0 space-y-2">
      <h4 className="text-xs font-semibold">Validate sample output</h4>
      <p className="text-xs text-muted-foreground">
        Check JSON against the {role} output contract for saved revision {revision}. This checks the
        output shape; it does not run an agent or accept work.
      </p>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (validation.isPending) return;
          validation.reset();
          if (!text.trim()) {
            setParseError('Enter JSON output to validate.');
            return;
          }
          if (text.length > PROMPT_OUTPUT_MAX_CHARS) {
            setParseError(
              `Output must be at most ${PROMPT_OUTPUT_MAX_CHARS.toLocaleString()} characters.`,
            );
            return;
          }
          let output: unknown;
          try {
            output = JSON.parse(text);
          } catch {
            setParseError('Invalid JSON. Check quotes, commas and brackets.');
            return;
          }
          setParseError(null);
          validation.mutate(output);
        }}
      >
        <label className="block text-xs" htmlFor={id}>
          Output JSON
        </label>
        <textarea
          id={id}
          value={text}
          rows={7}
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-limit${error ? ` ${id}-error` : ''}`}
          className="block w-full min-w-0 resize-y rounded border border-border bg-background p-2 font-mono text-xs"
          onChange={(event) => {
            setText(event.target.value);
            setParseError(null);
            validation.reset();
          }}
        />
        <p id={`${id}-limit`} className="text-xs text-muted-foreground">
          {text.length.toLocaleString()} / {PROMPT_OUTPUT_MAX_CHARS.toLocaleString()} characters
        </p>
        <Button size="sm" variant="outline" disabled={validation.isPending}>
          {validation.isPending ? 'Validating output…' : 'Validate output'}
        </Button>
      </form>
      {error ? (
        <div
          id={`${id}-error`}
          role="alert"
          className="space-y-1 break-words text-xs text-danger [overflow-wrap:anywhere]"
        >
          <p>{error}</p>
          {validation.isError && issues.success ? (
            <ul className="list-inside list-disc">
              {issues.data.map((issue, index) => (
                <li key={index}>
                  {issue.path.join('.') || 'output'}: {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {validation.isSuccess ? (
        <p role="status" className="text-xs">
          Output matches the {validation.data.role} contract for saved revision{' '}
          {validation.data.revision}.
        </p>
      ) : null}
    </section>
  );
}
