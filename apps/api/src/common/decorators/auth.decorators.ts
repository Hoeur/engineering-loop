import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'engloop:isPublic';

/** Marks a route as reachable without authentication (health, login, webhooks). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext): unknown => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
