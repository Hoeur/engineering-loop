import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { loginSchema } from '@engloop/schemas';
import { ApiEnvelopeResponse, ApiZodBody } from '../../common/decorators/api-envelope.decorator';
import {
  CurrentUser,
  Public,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService, type LoginResult } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Exchange credentials for a bearer token' })
  @ApiZodBody(loginSchema)
  @ApiEnvelopeResponse(201, undefined, 'Signed JWT and the resolved principal')
  async login(
    @Body(zodPipe(loginSchema)) body: { email: string; password: string },
  ): Promise<LoginResult> {
    return this.auth.login(body.email, body.password);
  }

  @Get('me')
  @ApiOperation({ summary: 'Return the authenticated principal' })
  @ApiEnvelopeResponse(200)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
