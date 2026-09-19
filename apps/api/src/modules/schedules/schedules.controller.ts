import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createScheduleSchema, updateScheduleSchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { SchedulesService } from './schedules.service';

@ApiTags('schedules')
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @ApiOperation({ summary: 'List schedules' })
  @ApiEnvelopeResponse(200)
  list(@Query('projectId') projectId?: string) {
    return this.schedules.list(projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one schedule' })
  @ApiEnvelopeResponse(200)
  findOne(@Param('id') id: string) {
    return this.schedules.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a schedule' })
  @ApiZodBody(createScheduleSchema)
  @ApiEnvelopeResponse(201)
  create(@Body(zodPipe(createScheduleSchema)) body: z.infer<typeof createScheduleSchema>) {
    return this.schedules.create(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a schedule' })
  @ApiZodBody(updateScheduleSchema)
  @ApiEnvelopeResponse(200)
  update(
    @Param('id') id: string,
    @Body(zodPipe(updateScheduleSchema)) body: z.infer<typeof updateScheduleSchema>,
  ) {
    return this.schedules.update(id, body);
  }

  @Post(':id/run')
  @ApiOperation({ summary: 'Fire a schedule immediately' })
  @ApiEnvelopeResponse(202)
  runNow(@Param('id') id: string) {
    return this.schedules.runNow(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a schedule' })
  @ApiEnvelopeResponse(200)
  remove(@Param('id') id: string) {
    return this.schedules.remove(id);
  }
}
