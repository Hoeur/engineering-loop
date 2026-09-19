import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createArchitectureDecisionSchema, upsertProjectMemorySchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { MemoryService } from './memory.service';

@ApiTags('memory')
@Controller()
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  @Get('projects/:projectId/memory')
  @ApiOperation({ summary: 'List project memory entries' })
  @ApiEnvelopeResponse(200)
  list(@Param('projectId') projectId: string, @Query('history') history?: string) {
    return this.memory.list(projectId, history === 'true');
  }

  @Post('projects/:projectId/memory')
  @ApiOperation({ summary: 'Write a new version of a memory entry' })
  @ApiZodBody(upsertProjectMemorySchema)
  @ApiEnvelopeResponse(201)
  upsert(
    @Param('projectId') projectId: string,
    @Body(zodPipe(upsertProjectMemorySchema)) body: z.infer<typeof upsertProjectMemorySchema>,
  ) {
    return this.memory.upsert(projectId, body);
  }

  @Get('projects/:projectId/decisions')
  @ApiOperation({ summary: 'List architecture decision records' })
  @ApiEnvelopeResponse(200)
  listDecisions(@Param('projectId') projectId: string) {
    return this.memory.listDecisions(projectId);
  }

  @Post('decisions')
  @ApiOperation({ summary: 'Record an architecture decision' })
  @ApiZodBody(createArchitectureDecisionSchema)
  @ApiEnvelopeResponse(201)
  createDecision(
    @Body(zodPipe(createArchitectureDecisionSchema))
    body: z.infer<typeof createArchitectureDecisionSchema>,
    @CurrentUser('id') userId: string,
  ) {
    return this.memory.createDecision(body, userId);
  }
}
