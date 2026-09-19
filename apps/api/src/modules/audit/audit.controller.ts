import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { auditQuerySchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';

@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'List audit log entries' })
  @ApiEnvelopeResponse(200)
  async list(@Query(zodPipe(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>) {
    return this.audit.list(query);
  }
}
