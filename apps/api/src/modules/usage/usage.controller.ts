import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { usageQuerySchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { UsageService } from './usage.service';

@ApiTags('usage')
@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  @ApiOperation({ summary: 'Token usage summary and time series' })
  @ApiEnvelopeResponse(200)
  summary(
    @CurrentUser('organizationId') organizationId: string,
    @Query(zodPipe(usageQuerySchema)) query: z.infer<typeof usageQuerySchema>,
  ) {
    return this.usage.summary(query.organizationId ?? organizationId, query);
  }
}
