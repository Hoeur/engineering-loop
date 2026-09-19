import { Global, Module } from '@nestjs/common';
import { BullMqOrchestrator, WORKFLOW_ORCHESTRATOR } from './bullmq-orchestrator';
import { QueueService } from './queue.service';

@Global()
@Module({
  providers: [
    QueueService,
    BullMqOrchestrator,
    { provide: WORKFLOW_ORCHESTRATOR, useExisting: BullMqOrchestrator },
  ],
  exports: [QueueService, WORKFLOW_ORCHESTRATOR],
})
export class QueueModule {}
