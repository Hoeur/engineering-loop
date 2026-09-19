import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { decideApprovalSchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ApprovalsService } from './approvals.service';

@ApiTags('approvals')
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  @ApiOperation({ summary: 'List approvals' })
  @ApiEnvelopeResponse(200)
  list(
    @CurrentUser('organizationId') organizationId: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ) {
    return this.approvals.list(organizationId, { projectId, status });
  }

  @Get('permission-levels')
  @ApiOperation({ summary: 'Permission-level catalogue' })
  @ApiEnvelopeResponse(200)
  levels() {
    return { items: this.approvals.levels(), meta: {} };
  }

  @Post(':id/decide')
  @ApiOperation({ summary: 'Approve or reject a pending approval' })
  @ApiZodBody(decideApprovalSchema)
  @ApiEnvelopeResponse(200)
  decide(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(decideApprovalSchema)) body: z.infer<typeof decideApprovalSchema>,
    @CurrentUser('id') userId: string,
  ) {
    return this.approvals.decide(organizationId, id, body.decision, body.note, userId);
  }
}
