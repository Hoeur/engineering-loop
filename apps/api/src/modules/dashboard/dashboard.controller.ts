import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Overview cards, active runs and recent activity' })
  @ApiEnvelopeResponse(200)
  overview(@CurrentUser('organizationId') organizationId: string) {
    return this.dashboard.overview(organizationId);
  }

  @Get('delivery-metrics')
  @ApiOperation({ summary: 'Cycle time, attempts and cost per completed task' })
  @ApiEnvelopeResponse(200)
  delivery(@CurrentUser('organizationId') organizationId: string) {
    return this.dashboard.deliveryMetrics(organizationId);
  }
}
