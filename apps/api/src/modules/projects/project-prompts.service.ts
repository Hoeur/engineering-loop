import { Injectable } from '@nestjs/common';
import {
  createPromptTemplateSchema,
  revisePromptTemplateSchema,
  renderPrompt,
  promptRoleSchema,
  validatePromptOutput,
  PROMPT_VARIABLES,
} from '@engloop/schemas';
import type {
  CreatePromptTemplateDto,
  RevisePromptTemplateDto,
  PromptVariable,
} from '@engloop/schemas';
import { ApiErrorCode, AuditAction, OrgRole } from '@engloop/types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ProjectPromptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private authorize(role: string) {
    if (role !== OrgRole.OWNER && role !== OrgRole.ADMIN)
      throw AppError.forbidden(
        'Only organization owners and administrators can edit project prompts',
      );
  }

  private async project(organizationId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true },
    });
    if (!project) throw AppError.notFound('Project', projectId);
  }

  async list(organizationId: string, projectId: string) {
    await this.project(organizationId, projectId);
    return this.prisma.promptTemplate.findMany({
      where: { projectId, project: { organizationId } },
      select: { id: true, name: true, role: true, currentRevision: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
  }

  async create(org: string, role: string, projectId: string, input: CreatePromptTemplateDto) {
    this.authorize(role);
    const dto = createPromptTemplateSchema.parse(input);
    return this.prisma.$transaction(async (tx) => {
      const projects = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM projects WHERE id = ${projectId} AND "organizationId" = ${org} FOR NO KEY UPDATE
      `;
      if (!projects.length) throw AppError.notFound('Project', projectId);
      if ((await tx.promptTemplate.count({ where: { projectId } })) >= 100)
        throw AppError.validation('A project may have at most 100 prompt templates');
      const template = await tx.promptTemplate.create({
        data: {
          projectId,
          name: dto.name,
          role: dto.role,
          revisions: { create: { revision: 1, body: dto.body } },
        },
        include: { revisions: true },
      });
      await this.audit.recordInTransaction(tx, {
        organizationId: org,
        projectId,
        action: AuditAction.CONFIGURATION_CHANGED,
        entityType: 'promptTemplate',
        entityId: template.id,
        summary: 'Created project prompt template',
        metadata: { revision: 1, role: dto.role },
      });
      return template;
    });
  }

  async revise(
    org: string,
    role: string,
    projectId: string,
    templateId: string,
    input: RevisePromptTemplateDto,
  ) {
    this.authorize(role);
    const dto = revisePromptTemplateSchema.parse(input);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM projects p WHERE p.id = ${projectId} AND p."organizationId" = ${org} FOR NO KEY UPDATE
      `;
      if (!rows.length) throw AppError.notFound('Project', projectId);
      const template = await tx.promptTemplate.findFirst({ where: { id: templateId, projectId } });
      if (!template) throw AppError.notFound('PromptTemplate', templateId);
      if (template.currentRevision !== dto.expectedRevision)
        throw AppError.conflict(
          ApiErrorCode.CONFLICT,
          'Prompt revision changed; reload before revising it',
          { currentRevision: template.currentRevision },
        );
      const revision = template.currentRevision + 1;
      const created = await tx.promptRevision.create({
        data: { templateId, revision, body: dto.body },
      });
      await tx.promptTemplate.update({
        where: { id: templateId },
        data: { currentRevision: revision },
      });
      await this.audit.recordInTransaction(tx, {
        organizationId: org,
        projectId,
        action: AuditAction.CONFIGURATION_CHANGED,
        entityType: 'promptTemplate',
        entityId: templateId,
        summary: 'Appended project prompt revision',
        metadata: { revision, previousRevision: template.currentRevision },
      });
      return created;
    });
  }

  async read(org: string, projectId: string, templateId: string, revision: number) {
    const found = await this.prisma.promptRevision.findFirst({
      where: { revision, templateId, template: { projectId, project: { organizationId: org } } },
      include: { template: { select: { id: true, name: true, role: true } } },
    });
    if (!found) throw AppError.notFound('PromptRevision', `${templateId}/${revision}`);
    return found;
  }

  async preview(
    org: string,
    projectId: string,
    templateId: string,
    revision: number,
    taskId: string,
  ) {
    const prompt = await this.read(org, projectId, templateId, revision);
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, projectId, project: { organizationId: org } },
      select: {
        id: true,
        title: true,
        description: true,
        objective: true,
        acceptanceCriteria: true,
        project: { select: { name: true, contractObjective: true } },
        phase: { select: { objective: true } },
      },
    });
    if (!task) throw AppError.notFound('Task', taskId);
    const context: Partial<Record<PromptVariable, string>> = {
      'task.title': task.title,
      'task.description': task.description,
      'task.objective': task.objective,
      'task.acceptanceCriteria': JSON.stringify(task.acceptanceCriteria),
      'project.name': task.project.name,
      'project.objective': task.project.contractObjective ?? '',
      role: prompt.template.role,
      ...(task.phase ? { 'phase.objective': task.phase.objective ?? '' } : {}),
    };
    try {
      return {
        templateId,
        revision,
        taskId,
        role: prompt.template.role,
        body: renderPrompt(prompt.body, context),
        supportedVariables: PROMPT_VARIABLES,
      };
    } catch (error) {
      throw AppError.validation(error instanceof Error ? error.message : 'Prompt preview failed');
    }
  }

  async validate(
    org: string,
    projectId: string,
    templateId: string,
    revision: number,
    output: unknown,
  ) {
    const prompt = await this.read(org, projectId, templateId, revision);
    try {
      validatePromptOutput(promptRoleSchema.parse(prompt.template.role), output);
      return { valid: true, templateId, revision, role: prompt.template.role };
    } catch {
      throw AppError.validation('Output does not satisfy the prompt role contract');
    }
  }
}
