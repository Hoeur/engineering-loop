import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { TestsService } from './tests.service';

@ApiTags('tests')
@Controller('test-runs')
export class TestsController {
  constructor(private readonly tests: TestsService) {}

  @Get()
  @ApiOperation({ summary: 'List test runs' })
  @ApiEnvelopeResponse(200)
  list(
    @CurrentUser('organizationId') organizationId: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Query('projectId') projectId?: string,
  ) {
    return this.tests.list(organizationId, Number(page) || 1, Number(pageSize) || 25, projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one test run with per-check output' })
  @ApiEnvelopeResponse(200)
  findOne(@CurrentUser('organizationId') organizationId: string, @Param('id') id: string) {
    return this.tests.findOne(organizationId, id);
  }
}
