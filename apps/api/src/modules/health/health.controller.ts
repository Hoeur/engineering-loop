import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { Public } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { AppConfigService } from '../../infrastructure/config/config.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — process is up' })
  @ApiEnvelopeResponse(200)
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — dependencies reachable' })
  @ApiEnvelopeResponse(200)
  async ready() {
    const [database, redis] = await Promise.all([this.prisma.healthy(), this.queues.health()]);
    return {
      status: database && redis.healthy ? 'ok' : 'degraded',
      dependencies: {
        database: { healthy: database },
        redis,
      },
    };
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Full health report' })
  @ApiEnvelopeResponse(200)
  async full() {
    const [database, redis, queues] = await Promise.all([
      this.prisma.healthy(),
      this.queues.health(),
      this.queues.counts(),
    ]);
    return {
      status: database && redis.healthy ? 'ok' : 'degraded',
      version: '0.1.0',
      environment: this.config.env.NODE_ENV,
      defaultAgentProvider: this.config.env.AGENT_DEFAULT_PROVIDER,
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: { database: { healthy: database }, redis },
      queues,
    };
  }
}
