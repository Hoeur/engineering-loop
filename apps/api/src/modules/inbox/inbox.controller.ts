import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { listInboxQuerySchema, type ListInboxQuery } from '@engloop/schemas';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { InboxService } from './inbox.service';

@ApiTags('inbox')
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @ApiOperation({ summary: 'Every decision awaiting a person, across sources' })
  @ApiEnvelopeResponse(200)
  list(
    @CurrentUser('organizationId') organizationId: string,
    @Query(zodPipe(listInboxQuerySchema)) query: ListInboxQuery,
  ) {
    return this.inbox.list(organizationId, query);
  }
}
