import { AgentRole, AgentRunStatus, ArtifactKind, RunStatus } from '@engloop/types';
import { documentationOutputSchema, parseSafely } from '@engloop/schemas';
import type { StepHandler } from './types';

/** Guards a single artifact against a pathological agent response. */
const MAX_DOCUMENT_BYTES = 256_000;

/**
 * A document path is model output, so it is untrusted.
 *
 * Only a repository-relative path is acceptable. Anything absolute, anything
 * containing a `..` segment, and anything with a Windows drive letter or a
 * backslash is rejected rather than normalised — a normalising filter invites
 * the next bypass, and there is no legitimate reason for a documentation agent
 * to name a path outside the repository it just read.
 */
const isSafeRelativePath = (candidate: string): boolean => {
  if (candidate.length === 0 || candidate.length > 400) return false;
  if (candidate.includes('\\') || candidate.includes('\0')) return false;
  if (candidate.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(candidate)) return false;
  return !candidate.split('/').includes('..');
};

/**
 * DOCUMENT — the documentation agent records what changed and why.
 *
 * Runs after the review is approved and before the pull request is opened, so a
 * PR description can cite documentation that already exists.
 *
 * The step writes `Artifact` rows rather than files in the worktree. Two
 * reasons: the diff has already been reviewed and approved at this point, so
 * adding unreviewed files to it would ship content no reviewer saw; and an
 * artifact is durable even when the worktree is destroyed.
 *
 * The step is `optional` in the workflow definition, so any failure here
 * degrades the run instead of failing a task whose code passed every gate.
 */
export const documentStep: StepHandler = async (context) => {
  const { worker, task, state, traceId, run, step, logger } = context;

  const workspacePath = state.worktreePath ?? task.worktreePath;
  if (!workspacePath) {
    return { status: RunStatus.SKIPPED, output: { reason: 'No worktree to document' } };
  }

  const outcome = await worker.agents.execute({
    taskId: task.id,
    role: AgentRole.DOCUMENTATION,
    input: {
      taskId: task.id,
      requirement: state.requirement,
      constraints: state.constraints,
      implementationSummary: state.lastImplementationSummary,
      plannerSummary: state.plannerSummary,
    },
    workspacePath,
    branchName: state.branchName,
    traceId,
    workflowRunId: run.id,
    workflowStepId: step.id,
  });

  if (outcome.status !== AgentRunStatus.SUCCEEDED) {
    return { status: RunStatus.FAILED, error: outcome.error ?? 'Documentation agent failed' };
  }

  const parsed = parseSafely(documentationOutputSchema, outcome.output, 'documentation output');
  if (!parsed.ok) {
    return { status: RunStatus.FAILED, error: parsed.error.message };
  }

  const accepted = parsed.data.documents.filter(
    (document) =>
      isSafeRelativePath(document.path) &&
      Buffer.byteLength(document.content, 'utf8') <= MAX_DOCUMENT_BYTES,
  );
  const rejectedCount = parsed.data.documents.length - accepted.length;

  if (rejectedCount > 0) {
    // Dropped, never silently: a rejected path is either a bug in the agent or
    // an attempt to escape the repository, and both are worth seeing.
    logger.warn(
      { taskId: task.id, rejectedCount },
      'document.rejected_unsafe_or_oversized_paths',
    );
  }

  if (accepted.length === 0) {
    return {
      status: RunStatus.SKIPPED,
      output: { reason: 'Agent produced no storable documents', rejectedCount },
    };
  }

  await worker.prisma.artifact.createMany({
    data: accepted.map((document) => ({
      taskId: task.id,
      agentRunId: outcome.agentRunId,
      kind: ArtifactKind.REPORT,
      name: document.path,
      contentType: 'text/markdown',
      sizeBytes: Buffer.byteLength(document.content, 'utf8'),
      content: document.content,
      metadata: { title: document.title, summary: parsed.data.summary },
    })),
  });

  return {
    status: RunStatus.SUCCEEDED,
    output: {
      documents: accepted.length,
      rejected: rejectedCount,
      gaps: parsed.data.gaps,
      summary: parsed.data.summary,
    },
  };
};
