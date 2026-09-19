import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../common/errors/app-error';
import { IS_PUBLIC_KEY, type AuthenticatedRequest } from '../../common/decorators/auth.decorators';
import { requestContextStorage } from '../../common/request-context';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization');

    if (header?.startsWith('Bearer ')) {
      request.user = await this.auth.verifyToken(header.slice('Bearer '.length).trim());
    } else {
      const devUser = await this.auth.resolveDevUser();
      if (!devUser) throw AppError.unauthorized();
      request.user = devUser;
    }

    const store = requestContextStorage.getStore();
    if (store && request.user) {
      store.actorId = request.user.id;
      store.actorType = 'USER';
      store.organizationId = request.user.organizationId;
    }

    return true;
  }
}
