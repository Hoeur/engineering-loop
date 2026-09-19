import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createEpicSchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { EpicsService } from './epics.service';

@ApiTags('epics')
@Controller('epics')
export class EpicsController {
  constructor(private readonly epics: EpicsService) {}

  @Get()
  @ApiOperation({ summary: 'List epics' })
  @ApiEnvelopeResponse(200)
  list(@Query('projectId') projectId?: string) {
    return this.epics.list(projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one epic' })
  @ApiEnvelopeResponse(200)
  findOne(@Param('id') id: string) {
    return this.epics.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create an epic' })
  @ApiZodBody(createEpicSchema)
  @ApiEnvelopeResponse(201)
  create(@Body(zodPipe(createEpicSchema)) body: z.infer<typeof createEpicSchema>) {
    return this.epics.create(body);
  }
}
