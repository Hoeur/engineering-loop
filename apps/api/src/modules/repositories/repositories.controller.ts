import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { repositoryCredentialSchema, updateRepositorySchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { RepositoriesService } from './repositories.service';

@ApiTags('repositories')
@Controller('repositories')
export class RepositoriesController {
  constructor(private readonly repositories: RepositoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List repositories' })
  @ApiEnvelopeResponse(200)
  list(
    @CurrentUser('organizationId') organizationId: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.repositories.list(organizationId, projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one repository' })
  @ApiEnvelopeResponse(200)
  findOne(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    return this.repositories.findOne(organizationId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update repository metadata and commands' })
  @ApiZodBody(updateRepositorySchema)
  @ApiEnvelopeResponse(200)
  update(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
    @Body(zodPipe(updateRepositorySchema)) body: z.infer<typeof updateRepositorySchema>,
  ) {
    return this.repositories.update(organizationId, role, id, body);
  }

  @Post(':id/credentials')
  @ApiOperation({ summary: 'Store an encrypted repository credential' })
  @ApiEnvelopeResponse(201, undefined, 'Returns a redacted preview only')
  addCredential(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
    @Body(zodPipe(repositoryCredentialSchema)) body: z.infer<typeof repositoryCredentialSchema>,
  ) {
    return this.repositories.addCredential(
      organizationId,
      role,
      id,
      body.name,
      body.kind,
      body.value,
    );
  }
}
