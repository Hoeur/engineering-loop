import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { notificationQuerySchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for the current organization' })
  @ApiEnvelopeResponse(200)
  list(
    @CurrentUser('organizationId') organizationId: string,
    @Query(zodPipe(notificationQuerySchema)) query: z.infer<typeof notificationQuerySchema>,
  ) {
    return this.notifications.list(organizationId, query.page, query.pageSize, query.unreadOnly);
  }

  @Get('channels')
  @ApiOperation({ summary: 'Notification channels and their wiring status' })
  @ApiEnvelopeResponse(200)
  channels() {
    return {
      items: this.notifications.channels(),
      meta: { types: this.notifications.typesCatalogue() },
    };
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiEnvelopeResponse(200)
  markRead(@Param('id') id: string) {
    return this.notifications.markRead(id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark every notification as read' })
  @ApiEnvelopeResponse(200)
  markAllRead(@CurrentUser('organizationId') organizationId: string) {
    return this.notifications.markAllRead(organizationId);
  }
}
