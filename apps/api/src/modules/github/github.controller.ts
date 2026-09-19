import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  githubAuthorizationCompleteSchema,
  githubAuthorizationStartSchema,
  githubImportRepositorySchema,
} from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { GitHubService } from './github.service';

@ApiTags('github')
@Controller('github')
export class GitHubController {
  constructor(private readonly github: GitHubService) {}

  @Post('authorization/start')
  @ApiOperation({ summary: 'Start a proof-bound GitHub App installation authorization' })
  @ApiZodBody(githubAuthorizationStartSchema)
  @ApiEnvelopeResponse(201)
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodPipe(githubAuthorizationStartSchema)) _body: Record<string, never>,
  ) {
    return this.github.startAuthorization(user);
  }

  @Post('authorization/complete')
  @ApiOperation({ summary: 'Verify GitHub user access and connect one installation' })
  @ApiZodBody(githubAuthorizationCompleteSchema)
  @ApiEnvelopeResponse(201)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodPipe(githubAuthorizationCompleteSchema))
    body: z.infer<typeof githubAuthorizationCompleteSchema>,
  ) {
    return this.github.completeAuthorization(user, body);
  }

  @Get('installations')
  @ApiOperation({ summary: 'List GitHub installations connected to this organization' })
  @ApiEnvelopeResponse(200)
  listInstallations(@CurrentUser('organizationId') organizationId: string) {
    return this.github.listInstallations(organizationId);
  }

  @Get('installations/:installationId/repositories')
  @ApiOperation({ summary: 'List repositories available to a connected GitHub installation' })
  @ApiEnvelopeResponse(200)
  listRepositories(
    @CurrentUser('organizationId') organizationId: string,
    @Param('installationId') installationId: string,
  ) {
    return this.github.listRepositories(organizationId, installationId);
  }

  @Post('repositories/import')
  @ApiOperation({ summary: 'Import a GitHub repository as an EngLoop project' })
  @ApiZodBody(githubImportRepositorySchema)
  @ApiEnvelopeResponse(201)
  importRepository(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodPipe(githubImportRepositorySchema)) body: z.infer<typeof githubImportRepositorySchema>,
  ) {
    return this.github.importRepository(user, body);
  }
}
