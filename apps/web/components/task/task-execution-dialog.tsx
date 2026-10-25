'use client';

import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@engloop/ui';
import type { ExecutionSelection } from '@engloop/schemas';
import { ExecutionSettings, modeLabel } from './execution-settings';

export function TaskExecutionDialog({
  taskId,
  projectId,
  mode,
  skipPlanning,
  close,
  start,
  error,
}: {
  taskId: string;
  projectId: string;
  mode: 'plan' | 'run';
  skipPlanning: boolean;
  close: () => void;
  start: (selection?: ExecutionSelection) => Promise<boolean>;
  error?: string | null;
}) {
  const [snapshot, setSnapshot] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const submitting = React.useRef(false);
  const submit = async (selection?: ExecutionSelection) => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setFailed(false);
    try {
      if (await start(selection)) close();
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      <DialogContent hideClose={pending} className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'plan' ? 'Plan task' : 'Start engineering loop'}</DialogTitle>
          <DialogDescription>
            {mode === 'plan'
              ? 'Inspect the repository and produce a plan.'
              : 'Run implementation, checks and review.'}{' '}
            Optionally freeze configuration and select saved prompt revisions for this run.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={snapshot}
            disabled={pending}
            onChange={(event) => setSnapshot(event.target.checked)}
          />
          Use frozen execution settings
        </label>
        {snapshot ? (
          <ExecutionSettings
            taskId={taskId}
            projectId={projectId}
            mode={mode}
            skipPlanning={skipPlanning}
            pending={pending}
            start={(selection) => void submit(selection)}
          />
        ) : (
          <Button size="sm" disabled={pending} onClick={() => void submit()}>
            {pending ? 'Starting…' : modeLabel(mode)}
          </Button>
        )}
        {failed ? (
          <p role="alert" className="text-xs text-danger">
            {error ?? 'Could not start. Please retry.'} Your selections are retained.
          </p>
        ) : null}
        <Button size="sm" variant="outline" disabled={pending} onClick={close}>
          Cancel
        </Button>
      </DialogContent>
    </Dialog>
  );
}
