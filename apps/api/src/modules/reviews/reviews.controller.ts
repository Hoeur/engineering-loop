import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateFindingSchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ReviewsService } from './reviews.service';

@ApiTags('reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('review-runs')
  @ApiOperation({ summary: 'List review runs' })
  @ApiEnvelopeResponse(200)
  listRuns(
    @CurrentUser('organizationId') organizationId: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Query('projectId') projectId?: string,
    @Query('decision') decision?: string,
  ) {
    return this.reviews.list(organizationId, Number(page) || 1, Number(pageSize) || 25, {
      projectId,
      decision,
    });
  }

  @Get('review-runs/:id')
  @ApiOperation({ summary: 'Fetch one review run with findings' })
  @ApiEnvelopeResponse(200)
  findOne(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    return this.reviews.findOne(organizationId, id);
  }

  @Get('review-findings')
  @ApiOperation({ summary: 'List structured review findings' })
  @ApiEnvelopeResponse(200)
  listFindings(
    @CurrentUser('organizationId') organizationId: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
  ) {
    return this.reviews.listFindings(organizationId, Number(page) || 1, Number(pageSize) || 25, {
      projectId,
      status,
      severity,
    });
  }

  @Patch('review-findings/:id')
  @ApiOperation({ summary: 'Update a finding status (resolve / accept risk / wont fix)' })
  @ApiZodBody(updateFindingSchema)
  @ApiEnvelopeResponse(200)
  updateFinding(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(updateFindingSchema)) body: z.infer<typeof updateFindingSchema>,
  ) {
    return this.reviews.updateFinding(organizationId, id, body.status, body.resolutionNote);
  }
}
