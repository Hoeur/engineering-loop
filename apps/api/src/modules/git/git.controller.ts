import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { GitApiService } from './git.service';

@ApiTags('git')
@Controller()
export class GitController {
  constructor(private readonly git: GitApiService) {}

  @Get('worktrees')
  @ApiOperation({ summary: 'List isolated agent worktrees' })
  @ApiEnvelopeResponse(200)
  worktrees(
    @CurrentUser('organizationId') organizationId: string,
    @Query('repositoryId') repositoryId?: string,
  ) {
    return this.git.listWorktrees(organizationId, repositoryId);
  }

  @Get('pull-requests')
  @ApiOperation({ summary: 'List pull requests' })
  @ApiEnvelopeResponse(200)
  pullRequests(
    @CurrentUser('organizationId') organizationId: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ) {
    return this.git.listPullRequests(organizationId, {
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 25,
      projectId,
      status,
    });
  }

  @Get('tasks/:taskId/diff')
  @ApiOperation({ summary: 'Latest stored diff artifact for a task' })
  @ApiEnvelopeResponse(200)
  diff(@CurrentUser('organizationId') organizationId: string, @Param('taskId') taskId: string) {
    return this.git.diff(organizationId, taskId);
  }

  @Get('tasks/:taskId/commits')
  @ApiOperation({ summary: 'Commits recorded for a task' })
  @ApiEnvelopeResponse(200)
  commits(
    @CurrentUser('organizationId') organizationId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.git.listCommits(organizationId, taskId);
  }
}
