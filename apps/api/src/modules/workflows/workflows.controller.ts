import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { listWorkflowRunsQuerySchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { WorkflowsService } from './workflows.service';

@ApiTags('workflows')
@Controller()
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get('workflows')
  @ApiOperation({ summary: 'List workflow definitions (declared in code)' })
  @ApiEnvelopeResponse(200)
  definitions() {
    return this.workflows.definitions();
  }

  @Get('workflow-runs')
  @ApiOperation({ summary: 'List workflow runs' })
  @ApiEnvelopeResponse(200)
  listRuns(
    @CurrentUser('organizationId') organizationId: string,
    @Query(zodPipe(listWorkflowRunsQuerySchema)) query: z.infer<typeof listWorkflowRunsQuerySchema>,
  ) {
    return this.workflows.listRuns(organizationId, query);
  }

  @Get('workflow-runs/:id')
  @ApiOperation({ summary: 'Live run payload: steps, agent runs, checks, reviews' })
  @ApiEnvelopeResponse(200)
  findOne(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    return this.workflows.findOne(organizationId, id);
  }

  @Post('workflow-runs/:id/cancel')
  @ApiOperation({ summary: 'Signal a workflow run to cancel' })
  @ApiEnvelopeResponse(202)
  cancel(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.workflows.cancel(organizationId, id, body?.reason ?? 'Cancelled by user');
  }
}
