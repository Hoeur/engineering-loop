import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { upsertAgentProviderSchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AgentProvidersService } from './agent-providers.service';

@ApiTags('agent-providers')
@Controller('agent-providers')
export class AgentProvidersController {
  constructor(private readonly providers: AgentProvidersService) {}

  @Get()
  @ApiOperation({ summary: 'List providers (credentials are never returned)' })
  @ApiEnvelopeResponse(200)
  list(@CurrentUser('organizationId') organizationId: string) {
    return this.providers.list(organizationId);
  }

  @Get('health')
  @ApiOperation({ summary: 'Last provider health probe recorded by the worker' })
  @ApiEnvelopeResponse(200)
  health(@CurrentUser('organizationId') organizationId: string) {
    return this.providers.health(organizationId);
  }

  @Post()
  @ApiOperation({ summary: 'Create or update a provider' })
  @ApiZodBody(upsertAgentProviderSchema)
  @ApiEnvelopeResponse(201)
  upsert(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Body(zodPipe(upsertAgentProviderSchema)) body: z.infer<typeof upsertAgentProviderSchema>,
  ) {
    return this.providers.upsert(organizationId, role, body);
  }

  @Delete(':key')
  @ApiOperation({ summary: 'Delete an unused provider' })
  @ApiEnvelopeResponse(200)
  remove(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Param('key') key: string,
  ) {
    return this.providers.remove(organizationId, role, key);
  }
}
