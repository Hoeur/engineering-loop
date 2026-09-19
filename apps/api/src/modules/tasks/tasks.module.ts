import { Module } from '@nestjs/common';
import { AgentRunsModule } from '../agent-runs/agent-runs.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TestsModule } from '../tests/tests.module';
import { TaskTransitionService } from './task-transition.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [TestsModule, ReviewsModule, AgentRunsModule],
  controllers: [TasksController],
  providers: [TasksService, TaskTransitionService],
  exports: [TasksService, TaskTransitionService],
})
export class TasksModule {}
