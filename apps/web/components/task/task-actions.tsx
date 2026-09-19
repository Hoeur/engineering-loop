'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCheck,
  GitPullRequest,
  Loader2,
  Play,
  RefreshCcw,
  ScanEye,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { TaskStatus } from '@engloop/types';
import { Button } from '@engloop/ui';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { useTaskAction } from '@/lib/queries';
import type { TaskDetail } from '@/lib/types';
import { ApiError } from '@/lib/api-client';

interface PendingAction {
  action: string;
  title: string;
  description: string;
  body?: unknown;
  destructive?: boolean;
  confirmLabel: string;
}

/**
 * Task action bar (spec section 27). Buttons reflect what the state machine
 * actually allows, so the UI can't offer a move the API will reject.
 */
export const TaskActions = ({ task }: { task: TaskDetail }): React.JSX.Element => {
  const router = useRouter();
  const mutation = useTaskAction(task.id);
  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const allowed = new Set(task.allowedTransitions);
  const isTerminal = task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED;
  const canPlan = allowed.has(TaskStatus.PLANNING) || task.status === TaskStatus.PLANNING;
  const canRun =
    allowed.has(TaskStatus.QUEUED) ||
    allowed.has(TaskStatus.IMPLEMENTING) ||
    task.status === TaskStatus.PLAN_READY;
  const canApprove = allowed.has(TaskStatus.APPROVED);
  const canRetry =
    task.status === TaskStatus.FAILED ||
    task.status === TaskStatus.NEEDS_HUMAN_REVIEW ||
    task.status === TaskStatus.TEST_FAILED;

  const run = async (input: PendingAction): Promise<void> => {
    setError(null);
    try {
      await mutation.mutateAsync({ action: input.action, body: input.body });
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? `${cause.code}: ${cause.message}`
          : cause instanceof Error
            ? cause.message
            : 'Action failed',
      );
    }
  };

  const button = (
    key: string,
    label: string,
    Icon: React.ElementType,
    input: PendingAction,
    variant: 'default' | 'outline' | 'destructive' = 'outline',
  ): React.JSX.Element => (
    <Button
      key={key}
      size="sm"
      variant={variant}
      disabled={mutation.isPending}
      onClick={() => setPending(input)}
    >
      {mutation.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
      {label}
    </Button>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canPlan &&
          button('plan', 'Plan', Sparkles, {
            action: 'plan',
            title: `Run the planner on ${task.key}?`,
            description:
              'The planner inspects the repository and produces an implementation plan with acceptance criteria. No code is modified.',
            confirmLabel: 'Run planner',
            body: {},
          })}

        {canRun &&
          button(
            'run',
            'Start',
            Play,
            {
              action: 'run',
              title: `Start the engineering loop for ${task.key}?`,
              description:
                'The full workflow runs: worktree, implementation, deterministic checks, review, and a pull request if the project permission allows it.',
              confirmLabel: 'Start run',
              body: { skipPlanning: task.acceptanceCriteria.length > 0 },
            },
            'default',
          )}

        {button('review', 'Request review', ScanEye, {
          action: 'review',
          title: `Queue a review for ${task.key}?`,
          description:
            'A reviewer agent inspects the current diff against the acceptance criteria.',
          confirmLabel: 'Queue review',
          body: { kind: 'CODE' },
        })}

        {button('tests', 'Run checks', RefreshCcw, {
          action: 'tests',
          title: `Run deterministic checks for ${task.key}?`,
          description:
            'EngLoop runs lint, typecheck, tests and build itself and records the real exit codes.',
          confirmLabel: 'Run checks',
          body: { checks: task.requiredChecks.length > 0 ? task.requiredChecks : undefined },
        })}

        {canApprove &&
          button(
            'approve',
            'Approve',
            CheckCheck,
            {
              action: 'approve',
              title: `Approve ${task.key}?`,
              description:
                'Approval is refused while any critical or high finding is still open. On approval a pull request is prepared.',
              confirmLabel: 'Approve task',
              body: { createPullRequest: true },
            },
            'default',
          )}

        {task.status === TaskStatus.APPROVED &&
          button('pr', 'Create PR', GitPullRequest, {
            action: 'run',
            title: `Create a pull request for ${task.key}?`,
            description:
              'The branch is pushed when a remote is configured; otherwise a local pull request record is created.',
            confirmLabel: 'Create pull request',
            body: { skipPlanning: true, force: true },
          })}

        {canRetry &&
          button('retry', 'Retry', RefreshCcw, {
            action: 'retry',
            title: `Retry ${task.key}?`,
            description: 'Attempt and review-cycle counters are reset before the loop restarts.',
            confirmLabel: 'Retry task',
            body: { resetAttempts: true },
          })}

        {!isTerminal &&
          button(
            'cancel',
            'Cancel',
            XCircle,
            {
              action: 'cancel',
              title: `Cancel ${task.key}?`,
              description:
                'In-flight workflow runs are signalled to stop and the task is cancelled.',
              confirmLabel: 'Cancel task',
              destructive: true,
              body: { reason: 'Cancelled from the task detail screen' },
            },
            'destructive',
          )}
      </div>

      {error ? (
        <p className="rounded-md border border-danger/25 bg-danger/5 px-2 py-1.5 text-xs text-danger-strong">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.title ?? ''}
        description={pending?.description}
        confirmLabel={pending?.confirmLabel ?? 'Confirm'}
        destructive={pending?.destructive}
        onConfirm={async () => {
          if (pending) await run(pending);
        }}
      />
    </div>
  );
};
