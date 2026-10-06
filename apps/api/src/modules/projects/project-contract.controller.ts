import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { replaceProjectContractSchema } from '@engloop/schemas';
import type { ReplaceProjectContractDto } from '@engloop/schemas';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ProjectContractService } from './project-contract.service';

@ApiTags('projects')
@Controller('projects/:projectId/contract')
export class ProjectContractController {
  constructor(private readonly contracts: ProjectContractService) {}

  @Get()
  @ApiOperation({ summary: 'Read the editable draft project contract' })
  @ApiEnvelopeResponse(200)
  read(@CurrentUser('organizationId') org: string, @Param('projectId') project: string) {
    return this.contracts.read(org, project);
  }

  @Put()
  @ApiOperation({ summary: 'Replace the draft project contract without activating work' })
  @ApiZodBody(replaceProjectContractSchema)
  @ApiEnvelopeResponse(200)
  replace(
    @CurrentUser('organizationId') org: string,
    @CurrentUser('role') role: string,
    @Param('projectId') project: string,
    @Body(zodPipe(replaceProjectContractSchema)) body: ReplaceProjectContractDto,
  ) {
    return this.contracts.replace(org, role, project, body);
  }
}
