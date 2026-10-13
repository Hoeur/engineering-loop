import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { replaceProjectTeamSchema } from '@engloop/schemas';
import type { ReplaceProjectTeamDto } from '@engloop/schemas';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ProjectTeamService } from './project-team.service';

@ApiTags('projects')
@Controller('projects/:projectId/team')
export class ProjectTeamController {
  constructor(private readonly teams: ProjectTeamService) {}

  @Get()
  @ApiOperation({ summary: 'Read explicit project team membership and required role coverage' })
  @ApiEnvelopeResponse(200)
  read(@CurrentUser('organizationId') org: string, @Param('projectId') project: string) {
    return this.teams.read(org, project);
  }

  @Put()
  @ApiOperation({
    summary: 'Replace idle project team membership without changing agent permissions',
  })
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
}
