'use client';

import * as React from 'react';
import { Button } from '@engloop/ui';
import { executionSelectionSchema, promptRoleSchema } from '@engloop/schemas';
import type { ExecutionPreviewRequest, ExecutionSelection } from '@engloop/schemas';
import { QueryBoundary } from '@/components/common/states';
import { useExecutionPreview } from '@/lib/execution-preview';
import { useProjectPrompts } from '@/lib/project-prompts';

type Props = {
  taskId: string;
  projectId: string;
  mode: 'plan' | 'run';
  skipPlanning: boolean;
  pending: boolean;
  start: (selection: ExecutionSelection) => void;
};

function PreviewResult({
  taskId,
  request,
  pending,
  start,
}: Pick<Props, 'taskId' | 'pending' | 'start'> & { request: ExecutionPreviewRequest }) {
  const preview = useExecutionPreview(taskId, request);
  return (
    <div className="space-y-3">
      <QueryBoundary query={preview} loadingLabel="Resolving execution settings…">
        {(data) => (
          <section aria-label="Execution settings preview" className="space-y-3 text-xs">
            <p className="text-muted-foreground">
              Configuration ceilings as of {new Date(data.capturedAt).toLocaleTimeString()}. Start
              revalidates current settings and freezes the selected revisions. Remaining spend,
              revocation and stricter runtime policy can further reduce these limits.
            </p>
            {data.roles.map((role) => (
              <div key={role.role} className="space-y-1 rounded border border-border p-2">
                <p className="break-words font-semibold">{role.role}</p>
                <p className="break-words [overflow-wrap:anywhere]">
                  {role.providerKey} · {role.model ?? 'Provider default model'} ·{' '}
                  {role.permissionLevel}
                </p>
                <p>
                  {role.budget.timeoutMs / 1000}s · {role.budget.maxTokens} tokens · $
                  {role.budget.maxCostUsd} per invocation
                </p>
                <p className="break-words [overflow-wrap:anywhere]">
                  Commands: {role.budget.allowedCommands.join(', ') || 'None'}
                </p>
                {role.prompt ? (
                  <>
                    <p>Saved prompt revision {role.prompt.revision}</p>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {role.prompt.rendered}
                    </pre>
                  </>
                ) : (
                  <p>Built-in role prompt</p>
                )}
              </div>
            ))}
          </section>
        )}
      </QueryBoundary>
      <Button
        size="sm"
        disabled={pending || !preview.isSuccess || preview.isFetching}
        onClick={() => start(request.execution)}
      >
        {pending ? 'Starting…' : modeLabel(request.mode)}
      </Button>
    </div>
  );
}

export const modeLabel = (mode: 'plan' | 'run') => (mode === 'plan' ? 'Run planner' : 'Start run');

export function ExecutionSettings(props: Props) {
  const { taskId, projectId, mode, skipPlanning, pending, start } = props;
  const baseline = useExecutionPreview(taskId, { mode, skipPlanning, execution: { prompts: [] } });
  const templates = useProjectPrompts(projectId);
  const [selections, setSelections] = React.useState<
    Record<string, { templateId: string; revision: string }>
  >({});
  const id = React.useId();
  const parsed = executionSelectionSchema.safeParse({
    prompts: Object.entries(selections).map(([role, selection]) => ({
      role,
      templateId: selection.templateId,
      revision: Number(selection.revision),
    })),
  });
  return (
    <div className="space-y-3">
      <QueryBoundary query={baseline} loadingLabel="Loading workflow roles…">
        {(data) => (
          <QueryBoundary query={templates} loadingLabel="Loading prompt choices…">
            {(prompts) => (
              <fieldset disabled={pending} className="min-w-0 space-y-3">
                <legend className="mb-2 text-xs">
                  Choose an exact saved revision for each role.
                </legend>
                {!prompts.length ? (
                  <p className="text-xs">No saved prompts. Built-in role prompts will be used.</p>
                ) : null}
                {data.roles.map(({ role }) => {
                  const choices = prompts.filter((template) => template.role === role);
                  const selection = selections[role];
                  return (
                    <div key={role} className="min-w-0 space-y-1">
                      <label htmlFor={`${id}-${role}`} className="block text-xs">
                        {role} prompt
                      </label>
                      <select
                        id={`${id}-${role}`}
                        value={selection?.templateId ?? ''}
                        className="h-8 w-full min-w-0 rounded border border-border bg-background text-xs"
                        onChange={(event) => {
                          const template = choices.find(
                            (choice) => choice.id === event.target.value,
                          );
                          setSelections((previous) => {
                            const next = { ...previous };
                            if (template)
                              next[promptRoleSchema.parse(role)] = {
                                templateId: template.id,
                                revision: String(template.currentRevision),
                              };
                            else delete next[role];
                            return next;
                          });
                        }}
                      >
                        <option value="">Built-in role prompt</option>
                        {choices.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                      {selection ? (
                        <label className="block text-xs">
                          {role} revision
                          <input
                            type="number"
                            min={1}
                            max={2147483647}
                            step={1}
                            value={selection.revision}
                            className="ml-2 h-8 w-20 rounded border border-border bg-background px-2"
                            onChange={(event) =>
                              setSelections((previous) => ({
                                ...previous,
                                [role]: { ...selection, revision: event.target.value },
                              }))
                            }
                          />
                        </label>
                      ) : null}
                    </div>
                  );
                })}
                {parsed.success ? (
                  <PreviewResult
                    key={JSON.stringify(parsed.data)}
                    taskId={taskId}
                    request={{ mode, skipPlanning, execution: parsed.data }}
                    pending={pending}
                    start={start}
                  />
                ) : (
                  <p role="alert" className="text-xs text-danger">
                    Enter a positive whole revision number.
                  </p>
                )}
              </fieldset>
            )}
          </QueryBoundary>
        )}
      </QueryBoundary>
    </div>
  );
}
