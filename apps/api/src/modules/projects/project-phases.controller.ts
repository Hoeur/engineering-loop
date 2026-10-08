import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createProjectPhaseSchema,
  updateProjectPhaseSchema,
  orderProjectPhasesSchema,
} from '@engloop/schemas';
import type {
  CreateProjectPhaseDto,
  UpdateProjectPhaseDto,
  OrderProjectPhasesDto,
} from '@engloop/schemas';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ProjectPhaseLifecycleService } from './project-phase-lifecycle.service';
import { ProjectPhasesService } from './project-phases.service';

@ApiTags('project-phases')
@Controller('projects/:projectId/phases')
export class ProjectPhasesController {
  constructor(
    private readonly phases: ProjectPhasesService,
    private readonly lifecycle: ProjectPhaseLifecycleService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List draft project phases in order' })
  @ApiEnvelopeResponse(200)
  list(@CurrentUser('organizationId') org: string, @Param('projectId') project: string) {
    return this.phases.list(org, project);
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft project phase' })
  @ApiZodBody(createProjectPhaseSchema)
  @ApiEnvelopeResponse(201)
  create(
    @CurrentUser('organizationId') org: string,
    @CurrentUser('role') role: string,
    @Param('projectId') project: string,
    @Body(zodPipe(createProjectPhaseSchema)) body: CreateProjectPhaseDto,
  ) {
    return this.phases.create(org, role, project, body);
  }

  @Post('order')
  @ApiOperation({ summary: 'Atomically replace the complete draft phase order' })
  @ApiZodBody(orderProjectPhasesSchema)
  @ApiEnvelopeResponse(201)
  order(
    @CurrentUser('organizationId') org: string,
    @CurrentUser('role') role: string,
    @Param('projectId') project: string,
    @Body(zodPipe(orderProjectPhasesSchema)) body: OrderProjectPhasesDto,
  ) {
    return this.phases.order(org, role, project, body.phaseIds);
  }

  @Get(':phaseId')
  @ApiOperation({ summary: 'Read a draft phase and linked tasks' })
  @ApiEnvelopeResponse(200)
  findOne(
    @CurrentUser('organizationId') org: string,
    @Param('projectId') project: string,
    @Param('phaseId') phase: string,
  ) {
    return this.phases.findOne(org, project, phase);
  }

  @Patch(':phaseId')
  @ApiOperation({ summary: 'Edit draft phase metadata' })
  @ApiZodBody(updateProjectPhaseSchema)
  @ApiEnvelopeResponse(200)
  update(
    @CurrentUser('organizationId') org: string,
    @CurrentUser('role') role: string,
    @Param('projectId') project: string,
    @Param('phaseId') phase: string,
    @Body(zodPipe(updateProjectPhaseSchema)) body: UpdateProjectPhaseDto,
  ) {
    return this.phases.update(org, role, project, phase, body);
  }

  @Post(':phaseId/activate')
  @ApiOperation({
    summary: 'Activate a phase planning contract after its prerequisites are accepted',
  })
  @ApiEnvelopeResponse(201)
  activate(
    @CurrentUser('organizationId') org: string,
    @CurrentUser('role') role: string,
    @Param('projectId') project: string,
    @Param('phaseId') phase: string,
  ) {
    return this.lifecycle.transition(org, role, project, phase, false);
  }

  @Post(':phaseId/reopen')
  @ApiOperation({ summary: 'Reopen an active phase for planning when linked tasks are idle' })
  @ApiEnvelopeResponse(201)
  reopen(
    @CurrentUser('organizationId') org: string,
    @CurrentUser('role') role: string,
    @Param('projectId') project: string,
    @Param('phaseId') phase: string,
  ) {
    return this.lifecycle.transition(org, role, project, phase, true);
  }

  @Delete(':phaseId')
  @ApiOperation({ summary: 'Delete a draft phase while preserving its tasks' })
  @ApiEnvelopeResponse(200)
  delete(
    @CurrentUser('organizationId') org: string,
    @CurrentUser('role') role: string,
    @Param('projectId') project: string,
    @Param('phaseId') phase: string,
  ) {
    return this.phases.delete(org, role, project, phase);
  }

  @Put(':phaseId/tasks/:taskId')
  @ApiOperation({ summary: 'Link an idle existing task to a draft phase' })
  @ApiEnvelopeResponse(200)
  link(
    @CurrentUser('organizationId') org: string,
    @CurrentUser('role') role: string,
    @Param('projectId') project: string,
    @Param('phaseId') phase: string,
    @Param('taskId') task: string,
  ) {
    return this.phases.membership(org, role, project, phase, task, true);
  }

  @Delete(':phaseId/tasks/:taskId')
  @ApiOperation({ summary: 'Unlink an idle task from its draft phase' })
  @ApiEnvelopeResponse(200)
  unlink(
    @CurrentUser('organizationId') org: string,
    @CurrentUser('role') role: string,
    @Param('projectId') project: string,
    @Param('phaseId') phase: string,
    @Param('taskId') task: string,
  ) {
    return this.phases.membership(org, role, project, phase, task, false);
  }
}
