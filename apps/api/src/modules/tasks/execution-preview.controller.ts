import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { executionPreviewRequestSchema } from '@engloop/schemas';
import type { ExecutionPreviewRequest } from '@engloop/schemas';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ExecutionPreviewService } from './execution-preview.service';

@ApiTags('tasks')
@Controller('tasks')
export class ExecutionPreviewController {
  constructor(private readonly previews: ExecutionPreviewService) {}

  @Post(':id/execution-preview')
  @ApiOperation({ summary: 'Preview execution configuration without creating or starting a run' })
  @ApiZodBody(executionPreviewRequestSchema)
  @ApiEnvelopeResponse(201)
  preview(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') taskId: string,
    @Body(zodPipe(executionPreviewRequestSchema)) body: ExecutionPreviewRequest,
  ) {
    return this.previews.preview(organizationId, taskId, body);
  }
}
