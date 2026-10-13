import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createPromptTemplateSchema,
  revisePromptTemplateSchema,
  previewPromptSchema,
  validatePromptOutputSchema,
  promptRevisionNumberSchema,
} from '@engloop/schemas';
import type { CreatePromptTemplateDto, RevisePromptTemplateDto } from '@engloop/schemas';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ProjectPromptsService } from './project-prompts.service';

@ApiTags('projects')
@Controller('projects/:projectId/prompts')
export class ProjectPromptsController {
  constructor(private readonly prompts: ProjectPromptsService) {}

  @Get()
  @ApiOperation({ summary: 'List project prompt templates' })
  @ApiEnvelopeResponse(200)
  list(@CurrentUser('organizationId') org: string, @Param('projectId') project: string) {
    return this.prompts.list(org, project);
  }

  @Post()
  @ApiOperation({ summary: 'Create a project prompt template and its first revision' })
  @ApiZodBody(createPromptTemplateSchema)
  @ApiEnvelopeResponse(201)
  create(
    @CurrentUser('organizationId') org: string,
    @CurrentUser('role') role: string,
    @Param('projectId') project: string,
    @Body(zodPipe(createPromptTemplateSchema)) body: CreatePromptTemplateDto,
  ) {
    return this.prompts.create(org, role, project, body);
  }

  @Post(':templateId/revisions')
  @ApiOperation({
    summary: 'Append an immutable prompt revision using the expected current revision',
  })
  @ApiZodBody(revisePromptTemplateSchema)
  @ApiEnvelopeResponse(201)
  revise(
    @CurrentUser('organizationId') org: string,
    @CurrentUser('role') role: string,
    @Param('projectId') project: string,
    @Param('templateId') template: string,
    @Body(zodPipe(revisePromptTemplateSchema)) body: RevisePromptTemplateDto,
  ) {
    return this.prompts.revise(org, role, project, template, body);
  }

  @Get(':templateId/revisions/:revision')
  @ApiOperation({ summary: 'Read an exact prompt revision' })
  @ApiEnvelopeResponse(200)
  read(
    @CurrentUser('organizationId') org: string,
    @Param('projectId') project: string,
    @Param('templateId') template: string,
    @Param('revision', zodPipe(promptRevisionNumberSchema)) revision: number,
  ) {
    return this.prompts.read(org, project, template, revision);
  }

  @Post(':templateId/revisions/:revision/preview')
  @ApiOperation({ summary: 'Preview a prompt against allowlisted task, project and phase fields' })
  @ApiZodBody(previewPromptSchema)
  @ApiEnvelopeResponse(201)
  preview(
    @CurrentUser('organizationId') org: string,
    @Param('projectId') project: string,
    @Param('templateId') template: string,
    @Param('revision', zodPipe(promptRevisionNumberSchema)) revision: number,
    @Body(zodPipe(previewPromptSchema)) body: { taskId: string },
  ) {
    return this.prompts.preview(org, project, template, revision, body.taskId);
  }

  @Post(':templateId/revisions/:revision/validate-output')
  @ApiOperation({
    summary: 'Validate output against the prompt role contract without accepting work',
  })
  @ApiZodBody(validatePromptOutputSchema)
  @ApiEnvelopeResponse(201)
  validate(
    @CurrentUser('organizationId') org: string,
    @Param('projectId') project: string,
    @Param('templateId') template: string,
    @Param('revision', zodPipe(promptRevisionNumberSchema)) revision: number,
    @Body(zodPipe(validatePromptOutputSchema)) body: { output?: unknown },
  ) {
    return this.prompts.validate(org, project, template, revision, body.output);
  }
}
