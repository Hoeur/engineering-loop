import { Injectable, Optional } from '@nestjs/common';
import { executionPreviewRequestSchema, executionPreviewSchema } from '@engloop/schemas';
import type { ExecutionPreviewRequest } from '@engloop/schemas';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { ExecutionSnapshotsService } from './execution-snapshots.service';

@Injectable()
export class ExecutionPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly snapshots = new ExecutionSnapshotsService(),
  ) {}

  async preview(organizationId: string, taskId: string, input: ExecutionPreviewRequest) {
    const parsed = executionPreviewRequestSchema.safeParse(input);
    if (!parsed.success) throw AppError.validation(parsed.error.message);
    const request = parsed.data;
    return this.prisma.$transaction(
      async (tx) => {
        const snapshot = await this.snapshots.capture(
          tx,
          organizationId,
          taskId,
          request.execution,
          { planOnly: request.mode === 'plan', skipPlanning: request.skipPlanning },
        );
        return executionPreviewSchema.parse({
          capturedAt: snapshot.capturedAt,
          taskId: snapshot.taskId,
          roles: snapshot.roles,
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
