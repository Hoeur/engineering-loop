'use client';

import * as React from 'react';
import { OrgRole } from '@engloop/types';
import type { ProjectPromptTemplate } from '@engloop/types';
import { Button } from '@engloop/ui';
import { QueryBoundary } from '@/components/common/states';
import { useCurrentUser } from '@/lib/queries';
import {
  useCreatePrompt,
  useProjectPrompts,
  usePromptRevision,
  useRevisePrompt,
} from '@/lib/project-prompts';
import { PromptForm } from './prompt-form';
import { PromptPreview } from './prompt-preview';

function PromptDetail({
  projectId,
  template,
  revision,
  canManage,
  select,
}: {
  projectId: string;
  template: ProjectPromptTemplate;
  revision: number;
  canManage: boolean;
  select: (revision: number) => void;
}) {
  const query = usePromptRevision(projectId, template.id, revision);
  const mutation = useRevisePrompt(projectId, template.id);
  const [editing, setEditing] = React.useState(false);
  const [revisionInput, setRevisionInput] = React.useState(String(revision));
  const id = React.useId();
  return (
    <div className="min-w-0 space-y-3 rounded border border-border p-3">
      <h3 className="break-words text-sm font-semibold">
        {template.name} · {template.role}
      </h3>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(revisionInput);
          if (Number.isInteger(value) && value >= 1 && value <= template.currentRevision)
            select(value);
        }}
      >
        <label className="text-xs" htmlFor={id}>
          Revision (latest: {template.currentRevision})
          <input
            id={id}
            type="number"
            required
            min={1}
            max={template.currentRevision}
            value={revisionInput}
            onChange={(e) => setRevisionInput(e.target.value)}
            className="ml-2 h-8 w-20 rounded border border-border bg-background px-2"
          />
        </label>
        <Button size="sm" variant="outline" disabled={mutation.isPending || editing}>
          View revision
        </Button>
      </form>
      <QueryBoundary query={query} entity="Prompt revision" loadingLabel="Loading prompt revision…">
        {(data) => (
          <>
            <p className="text-xs">
              Viewing saved revision {data.revision}. New revisions preserve this text.
            </p>
            {editing && canManage ? (
              <PromptForm
                initialBody={data.body}
                pending={mutation.isPending}
                revise={(body) =>
                  mutation.mutate(
                    { expectedRevision: revision, body },
                    { onSuccess: (saved) => select(saved.revision) },
                  )
                }
                cancel={() => {
                  setEditing(false);
                  mutation.reset();
                }}
              />
            ) : (
              <>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">
                  {data.body}
                </pre>
                {canManage && revision === template.currentRevision ? (
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    Edit as new revision
                  </Button>
                ) : null}
              </>
            )}
            <PromptPreview
              key={`${template.id}:${revision}`}
              projectId={projectId}
              templateId={template.id}
              revision={revision}
            />
          </>
        )}
      </QueryBoundary>
      {mutation.isError ? (
        <p role="alert" className="text-xs text-danger">
          {mutation.error.message} Your draft is retained. Cancel the edit and reload prompts before
          trying again.
        </p>
      ) : null}
    </div>
  );
}

export function ProjectPrompts({ projectId }: { projectId: string }) {
  const query = useProjectPrompts(projectId);
  const user = useCurrentUser();
  const canManage = user.data?.role === OrgRole.OWNER || user.data?.role === OrgRole.ADMIN;
  const create = useCreatePrompt(projectId);
  const [creating, setCreating] = React.useState(false);
  const [selected, setSelected] = React.useState<{ id: string; revision: number } | null>(null);
  return (
    <section
      className="mt-6 min-w-0 space-y-3 rounded-md border border-border p-3"
      aria-label="Project prompts"
    >
      <h2 className="text-sm font-semibold">Project prompts</h2>
      <p className="text-xs text-muted-foreground">
        Create role prompts and append immutable revisions. Saving a prompt does not change existing
        runs. Preview uses saved text; unsaved edits are excluded.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={query.isFetching || create.isPending}
        onClick={() => {
          void query.refetch();
        }}
      >
        Reload prompts
      </Button>
      <QueryBoundary query={query} entity="Project prompts" loadingLabel="Loading project prompts…">
        {(templates) => (
          <>
            {templates.length ? (
              <ul className="space-y-2">
                {templates.map((template) => (
                  <li key={template.id} className="min-w-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-auto min-h-8 max-w-full whitespace-normal break-words text-left"
                      disabled={create.isPending}
                      onClick={() => {
                        setCreating(false);
                        create.reset();
                        setSelected({ id: template.id, revision: template.currentRevision });
                      }}
                    >
                      {template.name} · {template.role} · revision {template.currentRevision}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs">No project prompts yet.</p>
            )}
            {canManage && !creating ? (
              <Button
                size="sm"
                variant="outline"
                disabled={templates.length >= 100}
                onClick={() => {
                  setSelected(null);
                  create.reset();
                  setCreating(true);
                }}
              >
                New prompt
              </Button>
            ) : null}
            {creating && canManage ? (
              <PromptForm
                pending={create.isPending}
                create={(body) =>
                  create.mutate(body, {
                    onSuccess: (saved) => {
                      setCreating(false);
                      setSelected({ id: saved.id, revision: saved.currentRevision });
                    },
                  })
                }
                cancel={() => {
                  setCreating(false);
                  create.reset();
                }}
              />
            ) : null}
            {selected
              ? templates
                  .filter((template) => template.id === selected.id)
                  .map((template) => (
                    <PromptDetail
                      key={`${projectId}:${template.id}:${selected.revision}`}
                      projectId={projectId}
                      template={template}
                      revision={selected.revision}
                      canManage={canManage}
                      select={(revision) => setSelected({ id: template.id, revision })}
                    />
                  ))
              : null}
          </>
        )}
      </QueryBoundary>
      {create.isError ? (
        <p role="alert" className="text-xs text-danger">
          {create.error.message}
        </p>
      ) : null}
    </section>
  );
}
