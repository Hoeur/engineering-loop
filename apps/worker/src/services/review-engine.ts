import { FindingStatus, ReviewDecision, RunStatus, Severity } from '@engloop/types';
import type { EngLoopLogger } from '@engloop/logger';
import type { PrismaClient } from '@engloop/db';
import type { ReviewOutput, UiReviewOutput } from '@engloop/schemas';

export interface PersistReviewInput {
  reviewRunId: string;
  taskId: string;
  agentRunId: string | null;
  output: ReviewOutput;
  cycle: number;
}

export interface ReviewOutcome {
  decision: ReviewDecision;
  findingCount: number;
  blockingCount: number;
  approved: boolean;
}

const BLOCKING: Severity[] = [Severity.CRITICAL, Severity.HIGH];

/**
 * Turns validated reviewer output into durable structured findings
 * (spec sections 14 and 43).
 *
 * A review is only "approved" when the model said so *and* zero critical/high
 * findings remain open — the schema already refuses the contradictory case, and
 * this recomputes it against the database rather than trusting the payload.
 */
export class ReviewEngine {
  constructor(private readonly deps: { prisma: PrismaClient; logger: EngLoopLogger }) {}

  async persist(input: PersistReviewInput): Promise<ReviewOutcome> {
    const { prisma, logger } = this.deps;

    const findings = input.output.findings;
    const blocking = findings.filter((finding) => BLOCKING.includes(finding.severity));
    const approved = input.output.decision === 'approved' && blocking.length === 0;
    const decision = approved ? ReviewDecision.APPROVED : ReviewDecision.CHANGES_REQUESTED;

    await prisma.$transaction([
      prisma.reviewRun.update({
        where: { id: input.reviewRunId },
        data: {
          status: RunStatus.SUCCEEDED,
          decision,
          score: Math.round(input.output.score),
          summary: input.output.summary,
          coverageAssessment: input.output.coverageAssessment,
          architectureAssessment: input.output.architectureAssessment,
          securityAssessment: input.output.securityAssessment,
          performanceAssessment: input.output.performanceAssessment,
          agentRunId: input.agentRunId,
          cycle: input.cycle,
          completedAt: new Date(),
        },
      }),
      prisma.reviewFinding.createMany({
        data: findings.map((finding) => ({
          reviewRunId: input.reviewRunId,
          taskId: input.taskId,
          severity: finding.severity,
          category: finding.category,
          file: finding.file,
          line: finding.line,
          problem: finding.problem,
          requiredFix: finding.requiredFix,
          evidence: finding.evidence,
          status: FindingStatus.OPEN,
        })),
      }),
    ]);

    logger.info(
      {
        reviewRunId: input.reviewRunId,
        decision,
        findings: findings.length,
        blocking: blocking.length,
      },
      'review.persisted',
    );

    return {
      decision,
      findingCount: findings.length,
      blockingCount: blocking.length,
      approved,
    };
  }

  async persistUi(input: {
    reviewRunId: string;
    taskId: string;
    agentRunId: string | null;
    output: UiReviewOutput;
  }): Promise<ReviewOutcome> {
    const { prisma } = this.deps;
    const findings = input.output.findings;
    const blocking = findings.filter((finding) => BLOCKING.includes(finding.severity));
    const approved = input.output.decision === 'approved' && blocking.length === 0;

    await prisma.$transaction([
      prisma.reviewRun.update({
        where: { id: input.reviewRunId },
        data: {
          status: RunStatus.SUCCEEDED,
          decision: approved ? ReviewDecision.APPROVED : ReviewDecision.CHANGES_REQUESTED,
          summary: input.output.summary,
          agentRunId: input.agentRunId,
          completedAt: new Date(),
        },
      }),
      prisma.reviewFinding.createMany({
        data: findings.map((finding) => ({
          reviewRunId: input.reviewRunId,
          taskId: input.taskId,
          severity: finding.severity,
          category: 'UI' as const,
          uiCategory: finding.category,
          viewport: finding.viewport,
          screenshotId: finding.screenshotId,
          file: finding.page,
          problem: finding.problem,
          requiredFix: finding.requiredFix,
          status: FindingStatus.OPEN,
        })),
      }),
    ]);

    return {
      decision: approved ? ReviewDecision.APPROVED : ReviewDecision.CHANGES_REQUESTED,
      findingCount: findings.length,
      blockingCount: blocking.length,
      approved,
    };
  }

  /** Open findings that must be handed back to the implementer as fix input. */
  async openFindings(taskId: string) {
    return this.deps.prisma.reviewFinding.findMany({
      where: { reviewRun: { taskId }, status: { in: [FindingStatus.OPEN, FindingStatus.FIXING] } },
      orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async markFindingsFixing(taskId: string): Promise<void> {
    await this.deps.prisma.reviewFinding.updateMany({
      where: { reviewRun: { taskId }, status: FindingStatus.OPEN },
      data: { status: FindingStatus.FIXING },
    });
  }

  async resolveFindings(taskId: string): Promise<void> {
    await this.deps.prisma.reviewFinding.updateMany({
      where: { reviewRun: { taskId }, status: { in: [FindingStatus.OPEN, FindingStatus.FIXING] } },
      data: { status: FindingStatus.RESOLVED, resolvedAt: new Date() },
    });
  }
}
