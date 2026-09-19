import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { ArtifactsService } from './artifacts.service';

@ApiTags('artifacts')
@Controller()
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Get('artifacts')
  @ApiOperation({ summary: 'List artifacts (content excluded)' })
  @ApiEnvelopeResponse(200)
  list(
    @CurrentUser('organizationId') organizationId: string,
    @Query('taskId') taskId?: string,
    @Query('agentRunId') agentRunId?: string,
    @Query('kind') kind?: string,
  ) {
    return this.artifacts.list(organizationId, { taskId, agentRunId, kind });
  }

  @Get('artifacts/:id')
  @ApiOperation({ summary: 'Fetch one artifact including its content' })
  @ApiEnvelopeResponse(200)
  findOne(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    return this.artifacts.findOne(organizationId, id);
  }

  @Get('tasks/:taskId/screenshots')
  @ApiOperation({ summary: 'UI QA screenshots for a task' })
  @ApiEnvelopeResponse(200)
  screenshots(
    @CurrentUser('organizationId') organizationId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.artifacts.screenshots(organizationId, taskId);
  }
}
