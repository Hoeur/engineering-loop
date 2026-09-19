import { Prisma } from '@engloop/db';

const projectScope = (organizationId: string, projectId?: string) => ({
  organizationId,
  ...(projectId ? { id: projectId } : {}),
});

/**
 * Agent runs may be attached through any combination of task, workflow run,
 * and workflow step. Authorization is deliberately fail-closed: a row needs
 * at least one owner and every populated owner must be inside the same tenant.
 */
export const ownedAgentRunWhere = (
  organizationId: string,
  projectId?: string,
): Prisma.AgentRunWhereInput => ({
  AND: [
    {
      OR: [
        { taskId: { not: null } },
        { workflowRunId: { not: null } },
        { workflowStepId: { not: null } },
      ],
    },
    {
      OR: [
        { taskId: null },
        { task: { project: projectScope(organizationId, projectId) } },
      ],
    },
    {
      OR: [
        { workflowRunId: null },
        { workflowRun: { project: projectScope(organizationId, projectId) } },
      ],
    },
    {
      OR: [
        { workflowStepId: null },
        {
          workflowStep: {
            workflowRun: { project: projectScope(organizationId, projectId) },
          },
        },
      ],
    },
    {
      OR: [
        { agentId: null },
        {
          agent: {
            organizationId,
            provider: { organizationId },
            ...(projectId ? { OR: [{ projectId: null }, { projectId }] } : {}),
          },
        },
      ],
    },
    {
      OR: [{ providerId: null }, { provider: { organizationId } }],
    },
  ],
});

/** Artifact rows follow the same all-populated-owners rule as agent runs. */
export const ownedArtifactWhere = (
  organizationId: string,
  projectId?: string,
): Prisma.ArtifactWhereInput => ({
  AND: [
    {
      OR: [
        { taskId: { not: null } },
        { agentRunId: { not: null } },
        { testRunId: { not: null } },
      ],
    },
    {
      OR: [{ taskId: null }, { task: { project: projectScope(organizationId, projectId) } }],
    },
    {
      OR: [{ agentRunId: null }, { agentRun: ownedAgentRunWhere(organizationId, projectId) }],
    },
    {
      OR: [
        { testRunId: null },
        { testRun: { task: { project: projectScope(organizationId, projectId) } } },
      ],
    },
  ],
});

/** A workflow run's project and optional task must both belong to the tenant. */
export const ownedWorkflowRunWhere = (
  organizationId: string,
  projectId?: string,
): Prisma.WorkflowRunWhereInput => ({
  AND: [
    { project: projectScope(organizationId, projectId) },
    {
      OR: [
        { taskId: null },
        { task: { project: projectScope(organizationId, projectId) } },
      ],
    },
  ],
});

export const ownedTestRunWhere = (
  organizationId: string,
  projectId?: string,
): Prisma.TestRunWhereInput => ({
  AND: [
    { task: { project: projectScope(organizationId, projectId) } },
    {
      OR: [
        { workflowRunId: null },
        { workflowRun: ownedWorkflowRunWhere(organizationId, projectId) },
      ],
    },
    {
      OR: [
        { workflowStepId: null },
        { workflowStep: { workflowRun: ownedWorkflowRunWhere(organizationId, projectId) } },
      ],
    },
  ],
});

export const ownedReviewRunWhere = (
  organizationId: string,
  projectId?: string,
): Prisma.ReviewRunWhereInput => ({
  AND: [
    { task: { project: projectScope(organizationId, projectId) } },
    {
      OR: [
        { workflowRunId: null },
        { workflowRun: ownedWorkflowRunWhere(organizationId, projectId) },
      ],
    },
    {
      OR: [
        { workflowStepId: null },
        { workflowStep: { workflowRun: ownedWorkflowRunWhere(organizationId, projectId) } },
      ],
    },
    {
      OR: [{ agentRunId: null }, { agentRun: ownedAgentRunWhere(organizationId, projectId) }],
    },
  ],
});

export const ownedApprovalWhere = (
  organizationId: string,
  projectId?: string,
): Prisma.ApprovalWhereInput => ({
  AND: [
    { project: projectScope(organizationId, projectId) },
    { OR: [{ taskId: null }, { task: { project: projectScope(organizationId, projectId) } }] },
    {
      OR: [
        { workflowRunId: null },
        { workflowRun: ownedWorkflowRunWhere(organizationId, projectId) },
      ],
    },
  ],
});

export const ownedScreenshotWhere = (
  organizationId: string,
  taskId?: string,
  projectId?: string,
): Prisma.ScreenshotWhereInput => ({
  AND: [
    { OR: [{ taskId: { not: null } }, { reviewRunId: { not: null } }] },
    ...(taskId ? [{ OR: [{ taskId: null }, { taskId }] }] : []),
    {
      OR: [
        { reviewRunId: null },
        {
          reviewRun: {
            ...(taskId ? { taskId } : {}),
            ...ownedReviewRunWhere(organizationId, projectId),
          },
        },
      ],
    },
  ],
});

export const ownedFindingWhere = (
  organizationId: string,
  taskId?: string,
  projectId?: string,
): Prisma.ReviewFindingWhereInput => ({
  AND: [
    {
      reviewRun: {
        ...(taskId ? { taskId } : {}),
        ...ownedReviewRunWhere(organizationId, projectId),
      },
    },
    ...(taskId ? [{ OR: [{ taskId: null }, { taskId }] }] : []),
    {
      OR: [
        { screenshotId: null },
        { screenshot: ownedScreenshotWhere(organizationId, taskId, projectId) },
      ],
    },
  ],
});

const workflowOwnerSql = (
  workflowId: Prisma.Sql,
  taskId: Prisma.Sql,
  projectId: Prisma.Sql,
  organizationId: string,
): Prisma.Sql => Prisma.sql`
  EXISTS (
    SELECT 1 FROM workflow_runs w
    JOIN projects wp ON wp.id = w."projectId"
    WHERE w.id = ${workflowId}
      AND w."projectId" = ${projectId}
      AND wp."organizationId" = ${organizationId}
      AND (w."taskId" IS NULL OR w."taskId" = ${taskId})
  )
`;

const stepOwnerSql = (
  stepId: Prisma.Sql,
  taskId: Prisma.Sql,
  projectId: Prisma.Sql,
  organizationId: string,
): Prisma.Sql => Prisma.sql`
  EXISTS (
    SELECT 1 FROM workflow_steps ws
    WHERE ws.id = ${stepId}
      AND ${workflowOwnerSql(Prisma.sql`ws."workflowRunId"`, taskId, projectId, organizationId)}
  )
`;

const agentRunOwnerSql = (
  agentRunId: Prisma.Sql,
  taskId: Prisma.Sql,
  projectId: Prisma.Sql,
  organizationId: string,
): Prisma.Sql => Prisma.sql`
  EXISTS (
    SELECT 1 FROM agent_runs ar
    WHERE ar.id = ${agentRunId}
      AND (ar."taskId" IS NOT NULL OR ar."workflowRunId" IS NOT NULL OR ar."workflowStepId" IS NOT NULL)
      AND (ar."taskId" IS NULL OR ar."taskId" = ${taskId})
      AND (ar."workflowRunId" IS NULL OR ${workflowOwnerSql(Prisma.sql`ar."workflowRunId"`, taskId, projectId, organizationId)})
      AND (ar."workflowStepId" IS NULL OR ${stepOwnerSql(Prisma.sql`ar."workflowStepId"`, taskId, projectId, organizationId)})
      AND (ar."providerId" IS NULL OR EXISTS (
        SELECT 1 FROM agent_providers ap
        WHERE ap.id = ar."providerId" AND ap."organizationId" = ${organizationId}
      ))
      AND (ar."agentId" IS NULL OR EXISTS (
        SELECT 1 FROM agents a
        JOIN agent_providers ap ON ap.id = a."providerId"
        WHERE a.id = ar."agentId"
          AND a."organizationId" = ${organizationId}
          AND ap."organizationId" = ${organizationId}
          AND (a."projectId" IS NULL OR a."projectId" = ${projectId})
      ))
  )
`;

const reviewRunOwnerSql = (
  alias: 'r' | 'sr',
  organizationId: string,
  projectId?: string,
): Prisma.Sql => {
  const run = Prisma.raw(alias);
  return Prisma.sql`
    EXISTS (
      SELECT 1 FROM tasks rt
      JOIN projects rp ON rp.id = rt."projectId"
      WHERE rt.id = ${run}."taskId"
        AND rp."organizationId" = ${organizationId}
        ${projectId ? Prisma.sql`AND rp.id = ${projectId}` : Prisma.empty}
        AND (${run}."workflowRunId" IS NULL OR ${workflowOwnerSql(Prisma.sql`${run}."workflowRunId"`, Prisma.sql`rt.id`, Prisma.sql`rt."projectId"`, organizationId)})
        AND (${run}."workflowStepId" IS NULL OR ${stepOwnerSql(Prisma.sql`${run}."workflowStepId"`, Prisma.sql`rt.id`, Prisma.sql`rt."projectId"`, organizationId)})
        AND (${run}."agentRunId" IS NULL OR ${agentRunOwnerSql(Prisma.sql`${run}."agentRunId"`, Prisma.sql`rt.id`, Prisma.sql`rt."projectId"`, organizationId)})
    )
  `;
};

/**
 * Prisma cannot compare a finding's scalar taskId with its review run's taskId.
 * Global finding reads use this SQL scope before ordering, pagination, or counts.
 */
export const ownedFindingSql = (organizationId: string, projectId?: string): Prisma.Sql =>
  Prisma.sql`
    FROM review_findings f
    JOIN review_runs r ON r.id = f."reviewRunId"
    WHERE ${reviewRunOwnerSql('r', organizationId, projectId)}
      AND (f."taskId" IS NULL OR f."taskId" = r."taskId")
      AND (f."screenshotId" IS NULL OR EXISTS (
        SELECT 1 FROM screenshots s
        WHERE s.id = f."screenshotId"
          AND (s."taskId" IS NOT NULL OR s."reviewRunId" IS NOT NULL)
          AND (s."taskId" IS NULL OR s."taskId" = r."taskId")
          AND (s."reviewRunId" IS NULL OR EXISTS (
            SELECT 1 FROM review_runs sr
            WHERE sr.id = s."reviewRunId"
              AND sr."taskId" = r."taskId"
              AND ${reviewRunOwnerSql('sr', organizationId, projectId)}
          ))
      ))
  `;
