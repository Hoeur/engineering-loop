import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateAgentSchema, upsertAgentSchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AgentsService } from './agents.service';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @ApiOperation({ summary: 'List configured agents' })
  @ApiEnvelopeResponse(200)
  list(
    @CurrentUser('organizationId') organizationId: string,
    @Query('projectId') projectId?: string,
    @Query('role') role?: string,
  ) {
    return this.agents.list({ organizationId, projectId, role });
  }

  @Get('team')
  @ApiOperation({ summary: 'Agent team view — every role with its bound agent' })
  @ApiEnvelopeResponse(200)
  team(
    @CurrentUser('organizationId') organizationId: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.agents.team(organizationId, projectId);
  }

  @Get('performance')
  @ApiOperation({ summary: 'Success rate, duration and spend per role/provider' })
  @ApiEnvelopeResponse(200)
  performance(@CurrentUser('organizationId') organizationId: string) {
    return this.agents.performance(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one agent' })
  @ApiEnvelopeResponse(200)
  findOne(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    return this.agents.findOne(organizationId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create an agent' })
  @ApiZodBody(upsertAgentSchema)
  @ApiEnvelopeResponse(201)
  create(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Body(zodPipe(upsertAgentSchema)) body: z.infer<typeof upsertAgentSchema>,
  ) {
    return this.agents.create(organizationId, role, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an agent' })
  @ApiZodBody(updateAgentSchema)
  @ApiEnvelopeResponse(200)
  update(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
    @Body(zodPipe(updateAgentSchema)) body: z.infer<typeof updateAgentSchema>,
  ) {
    return this.agents.update(organizationId, role, id, body);
  }
}
