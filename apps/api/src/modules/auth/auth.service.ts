import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { AppConfigService } from '../../infrastructure/config/config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';

export interface LoginResult {
  token: string;
  expiresIn: string;
  user: AuthenticatedUser;
}

/**
 * Dev-grade authentication.
 *
 * Deliberately minimal: the MVP scope (spec section 44) excludes real IdP
 * integration and advanced RBAC. What exists here is a real signed JWT plus
 * scrypt password verification, so the seams (guard, token issuance, membership
 * lookup) are in place for an OIDC provider to replace.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  static hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const derived = scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${derived}`;
  }

  static verifyPassword(password: string, stored: string | null): boolean {
    if (!stored) return false;
    const [scheme, salt, digest] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !digest) return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(digest, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }

  private secret(): Uint8Array {
    return createHash('sha256').update(this.config.env.AUTH_JWT_SECRET).digest();
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { take: 1, orderBy: { createdAt: 'asc' } } },
    });

    if (!user || !AuthService.verifyPassword(password, user.passwordHash)) {
      throw AppError.unauthorized('Invalid email or password');
    }

    const membership = user.memberships[0];
    if (!membership) throw AppError.forbidden('User does not belong to an organization');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const principal: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      organizationId: membership.organizationId,
      role: membership.role,
    };

    return {
      token: await this.issueToken(principal),
      expiresIn: this.config.env.AUTH_JWT_EXPIRES_IN,
      user: principal,
    };
  }

  async issueToken(user: AuthenticatedUser): Promise<string> {
    return new SignJWT({
      email: user.email,
      name: user.name,
      organizationId: user.organizationId,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setIssuer('engloop')
      .setExpirationTime(this.config.env.AUTH_JWT_EXPIRES_IN)
      .sign(this.secret());
  }

  async verifyToken(token: string): Promise<AuthenticatedUser> {
    try {
      const { payload } = await jwtVerify(token, this.secret(), { issuer: 'engloop' });
      return {
        id: String(payload.sub),
        email: String(payload.email ?? ''),
        name: String(payload.name ?? ''),
        organizationId: String(payload.organizationId ?? ''),
        role: String(payload.role ?? 'MEMBER'),
      };
    } catch {
      throw AppError.unauthorized('Invalid or expired token');
    }
  }

  /**
   * Development bypass. Resolves the seeded founder so the dashboard is usable
   * immediately after `pnpm db:seed`. Refuses to activate in production.
   */
  async resolveDevUser(): Promise<AuthenticatedUser | null> {
    if (!this.config.env.AUTH_DEV_BYPASS || this.config.isProduction) return null;

    const user = await this.prisma.user.findFirst({
      where: { email: this.config.env.AUTH_DEV_USER_EMAIL },
      include: { memberships: { take: 1, orderBy: { createdAt: 'asc' } } },
    });
    const membership = user?.memberships[0];
    if (!user || !membership) return null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      organizationId: membership.organizationId,
      role: membership.role,
    };
  }

  async me(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { take: 1, orderBy: { createdAt: 'asc' } } },
    });
    const membership = user?.memberships[0];
    if (!user || !membership) throw AppError.notFound('User', userId);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      organizationId: membership.organizationId,
      role: membership.role,
    };
  }
}
