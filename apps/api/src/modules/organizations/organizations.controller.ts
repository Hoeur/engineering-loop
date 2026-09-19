import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createOrganizationSchema } from '@engloop/schemas';
import type { z } from 'zod';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'List organizations' })
  @ApiEnvelopeResponse(200)
  list() {
    return this.organizations.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one organization' })
  @ApiEnvelopeResponse(200)
  findOne(@Param('id') id: string) {
    return this.organizations.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create an organization' })
  @ApiZodBody(createOrganizationSchema)
  @ApiEnvelopeResponse(201)
  create(@Body(zodPipe(createOrganizationSchema)) body: z.infer<typeof createOrganizationSchema>) {
    return this.organizations.create(body);
  }
}
