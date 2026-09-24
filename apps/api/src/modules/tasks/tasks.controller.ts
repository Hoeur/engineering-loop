import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  approveTaskSchema,
  createTaskCommentSchema,
  createTaskDependencySchema,
  createTaskSchema,
  listTasksQuerySchema,
  planTaskSchema,
  retryTaskSchema,
  runTaskSchema,
  taskIdempotencyKeySchema,
  transitionTaskSchema,
  triggerReviewSchema,
  triggerTestRunSchema,
  updateTaskSchema,
} from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ReviewsService } from '../reviews/reviews.service';
import { TestsService } from '../tests/tests.service';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly tests: TestsService,
    private readonly reviews: ReviewsService,
    private readonly agentRuns: AgentRunsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List tasks with filters and pagination' })
  @ApiEnvelopeResponse(200)
  list(
    @CurrentUser('organizationId') organizationId: string,
    @Query(zodPipe(listTasksQuerySchema)) query: z.infer<typeof listTasksQuerySchema>,
  ) {
    return this.tasks.list(organizationId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a task' })
  @ApiZodBody(createTaskSchema)
  @ApiEnvelopeResponse(201)
  create(
    @Body(zodPipe(createTaskSchema)) body: z.infer<typeof createTaskSchema>,
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const parsedKey = zodPipe(taskIdempotencyKeySchema.optional()).transform(idempotencyKey, {
      type: 'custom',
      data: 'Idempotency-Key',
    });
    return this.tasks.create(organizationId, body, userId, parsedKey);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Fetch one task with its full execution history' })
  @ApiEnvelopeResponse(200)
  findOne(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    return this.tasks.findOne(organizationId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update task fields (status is not updatable here)' })
  @ApiZodBody(updateTaskSchema)
  @ApiEnvelopeResponse(200)
  update(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(updateTaskSchema)) body: z.infer<typeof updateTaskSchema>,
  ) {
    return this.tasks.update(organizationId, id, body);
  }

  @Post(':id/transition')
  @ApiOperation({ summary: 'Move a task through the state machine' })
  @ApiZodBody(transitionTaskSchema)
  @ApiEnvelopeResponse(200, undefined, 'Returns 409 TASK_INVALID_TRANSITION for illegal moves')
  transition(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(transitionTaskSchema)) body: z.infer<typeof transitionTaskSchema>,
  ) {
    return this.tasks.transition(organizationId, id, body.to, body.reason);
  }

  @Post(':id/plan')
  @ApiOperation({ summary: 'Run the planner against this task' })
  @ApiZodBody(planTaskSchema)
  @ApiEnvelopeResponse(202)
  plan(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(planTaskSchema)) body: z.infer<typeof planTaskSchema>,
  ) {
    return this.tasks.plan(organizationId, id, body);
  }

  @Post(':id/run')
  @ApiOperation({ summary: 'Start the full engineering workflow' })
  @ApiZodBody(runTaskSchema)
  @ApiEnvelopeResponse(202)
  run(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(runTaskSchema)) body: z.infer<typeof runTaskSchema>,
  ) {
    return this.tasks.run(organizationId, id, body);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel the task and any in-flight runs' })
  @ApiEnvelopeResponse(200)
  cancel(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.tasks.cancel(organizationId, id, body?.reason ?? 'Cancelled by user');
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed or escalated task' })
  @ApiZodBody(retryTaskSchema)
  @ApiEnvelopeResponse(202)
  retry(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(retryTaskSchema)) body: z.infer<typeof retryTaskSchema>,
  ) {
    return this.tasks.retry(organizationId, id, body.resetAttempts);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Human approval — refuses while blocking findings are open' })
  @ApiZodBody(approveTaskSchema)
  @ApiEnvelopeResponse(200)
  approve(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(approveTaskSchema)) body: z.infer<typeof approveTaskSchema>,
    @CurrentUser('id') userId: string,
  ) {
    return this.tasks.approve(organizationId, id, body.note, body.createPullRequest, userId);
  }

  @Post(':id/tests')
  @ApiOperation({ summary: 'Queue an independent deterministic check run' })
  @ApiZodBody(triggerTestRunSchema)
  @ApiEnvelopeResponse(202)
  async runTests(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(triggerTestRunSchema)) body: z.infer<typeof triggerTestRunSchema>,
  ) {
    return this.tests.trigger(organizationId, id, body.checks);
  }

  @Post(':id/review')
  @ApiOperation({ summary: 'Queue a review run' })
  @ApiZodBody(triggerReviewSchema)
  @ApiEnvelopeResponse(202)
  async review(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(triggerReviewSchema)) body: z.infer<typeof triggerReviewSchema>,
  ) {
    return this.reviews.trigger(organizationId, id, body.kind);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment to a task' })
  @ApiZodBody(createTaskCommentSchema)
  @ApiEnvelopeResponse(201)
  comment(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(createTaskCommentSchema)) body: z.infer<typeof createTaskCommentSchema>,
    @CurrentUser('id') userId: string,
  ) {
    return this.tasks.addComment(organizationId, id, body.body, userId);
  }

  @Post(':id/dependencies')
  @ApiOperation({ summary: 'Declare a dependency; refuses cycles' })
  @ApiZodBody(createTaskDependencySchema)
  @ApiEnvelopeResponse(201)
  addDependency(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(createTaskDependencySchema)) body: z.infer<typeof createTaskDependencySchema>,
  ) {
    return this.tasks.addDependency(organizationId, id, body.dependsOnTaskId, body.type);
  }

  @Get(':id/runs')
  @ApiOperation({ summary: 'Agent runs for a task' })
  @ApiEnvelopeResponse(200)
  async runs(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    return this.agentRuns.listForTask(organizationId, id);
  }

  @Get(':id/tests')
  @ApiOperation({ summary: 'Test runs for a task' })
  @ApiEnvelopeResponse(200)
  async testRuns(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    return this.tests.listForTask(organizationId, id);
  }

  @Get(':id/reviews')
  @ApiOperation({ summary: 'Review runs and findings for a task' })
  @ApiEnvelopeResponse(200)
  async reviewRuns(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    return this.reviews.listForTask(organizationId, id);
  }
}
