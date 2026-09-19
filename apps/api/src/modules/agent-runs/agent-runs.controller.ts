import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { listAgentRunsQuerySchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AgentRunsService } from './agent-runs.service';

@ApiTags('agent-runs')
@Controller('agent-runs')
export class AgentRunsController {
  constructor(private readonly runs: AgentRunsService) {}

  @Get()
  @ApiOperation({ summary: 'List agent runs' })
  @ApiEnvelopeResponse(200)
  list(
    @CurrentUser('organizationId') organizationId: string,
    @Query(zodPipe(listAgentRunsQuerySchema)) query: z.infer<typeof listAgentRunsQuerySchema>,
  ) {
    return this.runs.list(organizationId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one agent run with its message trace' })
  @ApiEnvelopeResponse(200)
  findOne(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    return this.runs.findOne(organizationId, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a running agent' })
  @ApiEnvelopeResponse(200)
  cancel(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.runs.cancel(organizationId, id, body?.reason ?? 'Cancelled by user');
  }
}
