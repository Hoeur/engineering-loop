import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser, Public } from '../../common/decorators/auth.decorators';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Public()
  @Post('github')
  @HttpCode(202)
  @ApiOperation({
    summary: 'GitHub webhook intake with exact-byte verification and idempotent sync',
  })
  @ApiEnvelopeResponse(202)
  github(
    @Req() request: RawBodyRequest<Request>,
    @Body() body: Record<string, unknown>,
    @Headers('x-github-event') eventType = 'unknown',
    @Headers('x-github-delivery') deliveryId?: string,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    return this.webhooks.receiveGitHub({
      rawBody: request.rawBody,
      signature,
      eventType,
      deliveryId,
      payload: body,
    });
  }

  @Get('events')
  @ApiOperation({ summary: 'Recent webhook deliveries' })
  @ApiEnvelopeResponse(200)
  list(@CurrentUser('organizationId') organizationId: string, @Query('limit') limit = '50') {
    return this.webhooks.list(organizationId, Number(limit) || 50);
  }
}
