import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users' })
  @ApiEnvelopeResponse(200)
  list(@Query('organizationId') organizationId?: string) {
    return this.users.list(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one user' })
  @ApiEnvelopeResponse(200)
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }
}
