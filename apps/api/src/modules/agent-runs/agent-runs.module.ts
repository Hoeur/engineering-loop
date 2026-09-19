import { Module } from '@nestjs/common';
import { AgentRunsController } from './agent-runs.controller';
import { AgentRunsService } from './agent-runs.service';

@Module({
  controllers: [AgentRunsController],
  providers: [AgentRunsService],
  exports: [AgentRunsService],
})
export class AgentRunsModule {}
