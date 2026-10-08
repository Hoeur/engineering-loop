import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { replaceProjectTeamSchema } from '@engloop/schemas';
import type { ReplaceProjectTeamDto } from '@engloop/schemas';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ProjectTeamService } from './project-team.service';

@ApiTags('projects')
@Controller('projects/:projectId')
export class ProjectTeamController {
  constructor(private readonly teams: ProjectTeamService) {}

  @Get('team')
  @ApiOperation({ summary: 'Read the explicit project team and eligible role coverage' })
  @ApiEnvelopeResponse(200)
  read(@CurrentUser('organizationId') org: string, @Param('projectId') project: string) {
    return this.teams.read(org, project);
  }

  @Put('team')
  @ApiOperation({ summary: 'Replace project team membership using its expected version' })
  @ApiZodBody(replaceProjectTeamSchema)
  @ApiEnvelopeResponse(200)
  replace(
    @CurrentUser('organizationId') org: string,
    @CurrentUser('role') role: string,
    @Param('projectId') project: string,
    @Body(zodPipe(replaceProjectTeamSchema)) body: ReplaceProjectTeamDto,
  ) {
    return this.teams.replace(org, role, project, body);
  }

  @Get('phases/:phaseId/role-coverage')
  @ApiOperation({ summary: 'Read explicit team coverage of the phase required roles' })
  @ApiEnvelopeResponse(200)
  coverage(
    @CurrentUser('organizationId') org: string,
    @Param('projectId') project: string,
    @Param('phaseId') phase: string,
  ) {
    return this.teams.roleCoverage(org, project, phase);
  }
}
