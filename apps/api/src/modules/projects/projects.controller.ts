import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createProjectSchema,
  createRepositorySchema,
  listProjectsQuerySchema,
  roleAssignmentSchema,
  updateProjectSchema,
} from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { TasksService } from '../tasks/tasks.service';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly tasks: TasksService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List projects' })
  @ApiEnvelopeResponse(200)
  list(
    @CurrentUser('organizationId') organizationId: string,
    @Query(zodPipe(listProjectsQuerySchema)) query: z.infer<typeof listProjectsQuerySchema>,
  ) {
    return this.projects.list({ ...query, organizationId });
  }

  @Post()
  @ApiOperation({ summary: 'Create a project' })
  @ApiZodBody(createProjectSchema)
  @ApiEnvelopeResponse(201)
  create(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Body(zodPipe(createProjectSchema)) body: z.infer<typeof createProjectSchema>,
  ) {
    return this.projects.create(organizationId, role, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one project' })
  @ApiEnvelopeResponse(200)
  findOne(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    return this.projects.findOne(organizationId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a project' })
  @ApiZodBody(updateProjectSchema)
  @ApiEnvelopeResponse(200)
  update(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
    @Body(zodPipe(updateProjectSchema)) body: z.infer<typeof updateProjectSchema>,
  ) {
    return this.projects.update(organizationId, role, id, body);
  }

  @Get(':id/repositories')
  @ApiOperation({ summary: 'List repositories in a project' })
  @ApiEnvelopeResponse(200)
  listRepositories(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    return this.projects.listRepositories(organizationId, id);
  }

  @Post(':id/repositories')
  @ApiOperation({ summary: 'Connect a repository to a project' })
  @ApiZodBody(createRepositorySchema)
  @ApiEnvelopeResponse(201)
  addRepository(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
    @Body(zodPipe(createRepositorySchema)) body: z.infer<typeof createRepositorySchema>,
  ) {
    return this.projects.addRepository(organizationId, role, id, body);
  }

  @Get(':id/board')
  @ApiOperation({ summary: 'Kanban board payload for a project' })
  @ApiEnvelopeResponse(200)
  async board(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    await this.projects.assertProject(organizationId, id);
    return this.tasks.board(organizationId, id);
  }

  @Post(':id/role-assignments')
  @ApiOperation({ summary: 'Map agent roles to configured agents' })
  @ApiZodBody(roleAssignmentSchema)
  @ApiEnvelopeResponse(200)
  setRoles(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
    @Body(zodPipe(roleAssignmentSchema)) body: z.infer<typeof roleAssignmentSchema>,
  ) {
    return this.projects.setRoleAssignments(organizationId, role, id, body.assignments);
  }
}
