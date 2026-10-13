import { PERMISSION_LEVEL_ORDER, type PermissionLevel } from '@engloop/types';
import {
  workflowExecutionSnapshotSchema,
  plannerOutputSchema,
  type WorkflowExecutionSnapshot,
} from '@engloop/schemas';

export function readExecutionSnapshot(
  value: unknown,
  owner: { taskId: string; projectId: string; organizationId: string },
): WorkflowExecutionSnapshot | undefined {
  if (value === null || value === undefined) return undefined;
  const snapshot = workflowExecutionSnapshotSchema.parse(value);
  if (
    snapshot.taskId !== owner.taskId ||
    snapshot.task.id !== owner.taskId ||
    snapshot.projectId !== owner.projectId ||
    snapshot.project.id !== owner.projectId ||
    snapshot.organizationId !== owner.organizationId
  )
    throw new Error('Execution snapshot does not belong to the task, project and organization');
  return snapshot;
}

export function plannedSnapshotContract(
  snapshot: WorkflowExecutionSnapshot,
  steps: readonly { stepKey: string; status: string; output: unknown }[],
) {
  const planned = [...steps]
    .reverse()
    .find((step) => step.stepKey === 'PLAN' && step.status === 'SUCCEEDED');
  if (!planned)
    return {
      acceptanceCriteria: snapshot.task.acceptanceCriteria,
      requiredChecks: snapshot.task.requiredChecks,
    };
  const plan = plannerOutputSchema.parse(planned.output);
  return {
    acceptanceCriteria: [
      ...new Set([...snapshot.task.acceptanceCriteria, ...plan.acceptanceCriteria]),
    ],
    requiredChecks: [...new Set([...snapshot.task.requiredChecks, ...plan.requiredChecks])],
  };
}

export function narrowPermission(...levels: PermissionLevel[]): PermissionLevel {
  return PERMISSION_LEVEL_ORDER[
    Math.min(...levels.map((level) => PERMISSION_LEVEL_ORDER.indexOf(level)))
  ]!;
}
