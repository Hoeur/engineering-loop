'use client';

import * as React from 'react';
import { Button } from '@engloop/ui';
import { QueryBoundary } from '@/components/common/states';
import { useBoard } from '@/lib/queries';
import { usePreviewPrompt } from '@/lib/project-prompts';

function PreviewResult({
  projectId,
  templateId,
  revision,
  taskId,
}: {
  projectId: string;
  templateId: string;
  revision: number;
  taskId: string;
}) {
  const preview = usePreviewPrompt(projectId, templateId, revision, taskId);
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        disabled={preview.isPending}
        onClick={() => preview.mutate()}
      >
        {preview.isPending ? 'Rendering prompt…' : 'Preview saved revision'}
      </Button>
      {preview.isError ? (
        <p role="alert" className="text-xs text-danger">
          {preview.error.message}
        </p>
      ) : null}
      {preview.isSuccess ? (
        <div aria-label="Rendered prompt" className="space-y-2">
          <p className="text-xs">
            Revision {preview.data.revision} · {preview.data.role}
          </p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-border p-2 text-xs [overflow-wrap:anywhere]">
            {preview.data.body}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function PromptPreview({
  projectId,
  templateId,
  revision,
}: {
  projectId: string;
  templateId: string;
  revision: number;
}) {
  const tasks = useBoard(projectId);
  const [taskId, setTask] = React.useState('');
  const id = React.useId();
  return (
    <section className="min-w-0 space-y-2" aria-label="Prompt preview">
      <h4 className="text-xs font-semibold">Task-bound prompt preview</h4>
      <p className="text-xs text-muted-foreground">
        Renders this saved revision with current task, project and phase fields. Preview does not
        start a run or freeze execution settings.
      </p>
      <QueryBoundary query={tasks} loadingLabel="Loading preview tasks…">
        {(data) =>
          data.items.length ? (
            <>
              <label className="block text-xs" htmlFor={id}>
                Preview task
              </label>
              <select
                id={id}
                className="h-8 w-full min-w-0 rounded border border-border bg-background text-sm"
                value={taskId}
                onChange={(e) => setTask(e.target.value)}
              >
                <option value="">Choose a task</option>
                {data.items.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.key}: {task.title}
                  </option>
                ))}
              </select>
              {data.items.some((task) => task.id === taskId) ? (
                <PreviewResult
                  key={taskId}
                  projectId={projectId}
                  templateId={templateId}
                  revision={revision}
                  taskId={taskId}
                />
              ) : null}
            </>
          ) : (
            <p className="text-xs">Create a task in this project to preview a prompt.</p>
          )
        }
      </QueryBoundary>
    </section>
  );
}
