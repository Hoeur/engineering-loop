import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { usageQuerySchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CostService } from './cost.service';

@ApiTags('costs')
@Controller('costs')
export class CostController {
  constructor(private readonly cost: CostService) {}

  @Get()
  @ApiOperation({ summary: 'Spend summary: today, week, month, by provider/project' })
  @ApiEnvelopeResponse(200)
  summary(
    @CurrentUser('organizationId') organizationId: string,
    @Query(zodPipe(usageQuerySchema)) query: z.infer<typeof usageQuerySchema>,
  ) {
    return this.cost.summary(query.organizationId ?? organizationId, query);
  }

  @Get('by-task')
  @ApiOperation({ summary: 'Most expensive tasks' })
  @ApiEnvelopeResponse(200)
  byTask(@CurrentUser('organizationId') organizationId: string, @Query('limit') limit = '20') {
    return this.cost.byTask(organizationId, Number(limit) || 20);
  }
}
