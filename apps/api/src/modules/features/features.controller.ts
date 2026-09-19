import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createFeatureSchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { FeaturesService } from './features.service';

@ApiTags('features')
@Controller('features')
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get()
  @ApiOperation({ summary: 'List features' })
  @ApiEnvelopeResponse(200)
  list(@Query('projectId') projectId?: string, @Query('epicId') epicId?: string) {
    return this.features.list(projectId, epicId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one feature' })
  @ApiEnvelopeResponse(200)
  findOne(@Param('id') id: string) {
    return this.features.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a feature' })
  @ApiZodBody(createFeatureSchema)
  @ApiEnvelopeResponse(201)
  create(@Body(zodPipe(createFeatureSchema)) body: z.infer<typeof createFeatureSchema>) {
    return this.features.create(body);
  }
}
