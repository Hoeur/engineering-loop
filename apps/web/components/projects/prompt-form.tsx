'use client';

import * as React from 'react';
import {
  createPromptTemplateSchema,
  promptBodySchema,
  promptRoleSchema,
  PROMPT_VARIABLES,
} from '@engloop/schemas';
import type { CreatePromptTemplateDto, PromptRole } from '@engloop/schemas';
import { Button } from '@engloop/ui';

export function PromptForm({
  initialBody = '',
  pending,
  create,
  revise,
  cancel,
}: {
  initialBody?: string;
  pending: boolean;
  create?: (body: CreatePromptTemplateDto) => void;
  revise?: (body: string) => void;
  cancel: () => void;
}) {
  const id = React.useId();
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState<PromptRole>(promptRoleSchema.options[0]);
  const [body, setBody] = React.useState(initialBody);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = create
          ? createPromptTemplateSchema.safeParse({ name, role, body })
          : promptBodySchema.safeParse(body);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Invalid prompt');
          return;
        }
        setError(null);
        if (create) create(createPromptTemplateSchema.parse({ name, role, body }));
        else revise?.(promptBodySchema.parse(body));
      }}
    >
      <fieldset disabled={pending} className="min-w-0 space-y-3">
        <legend className="sr-only">{create ? 'New prompt' : 'Append prompt revision'}</legend>
        {create ? (
          <>
            <label className="block text-xs" htmlFor={`${id}-name`}>
              Prompt name
            </label>
            <input
              id={`${id}-name`}
              className="h-8 w-full min-w-0 rounded border border-border bg-background px-2 text-sm"
              maxLength={120}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <label className="block text-xs" htmlFor={`${id}-role`}>
              Prompt role
            </label>
            <select
              id={`${id}-role`}
              className="h-8 w-full min-w-0 rounded border border-border bg-background text-sm"
              value={role}
              onChange={(e) => setRole(promptRoleSchema.parse(e.target.value))}
            >
              {promptRoleSchema.options.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </>
        ) : null}
        <label className="block text-xs" htmlFor={`${id}-body`}>
          Prompt body
        </label>
        <textarea
          id={`${id}-body`}
          className="min-h-40 w-full min-w-0 rounded border border-border bg-background p-2 font-mono text-xs"
          required
          maxLength={20000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-describedby={`${id}-help`}
        />
        <p id={`${id}-help`} className="break-words text-xs text-muted-foreground">
          Supported variables: {PROMPT_VARIABLES.map((variable) => `{{${variable}}}`).join(', ')}.
          Maximum 20,000 characters.
        </p>
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" type="submit">
            {pending ? 'Saving prompt…' : create ? 'Create prompt' : 'Save new revision'}
          </Button>
          <Button size="sm" type="button" variant="outline" onClick={cancel}>
            Cancel prompt edit
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
