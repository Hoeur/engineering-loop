import { Module } from '@nestjs/common';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';
import { AgentRunsModule } from '../agent-runs/agent-runs.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [AgentRunsModule, TasksModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
