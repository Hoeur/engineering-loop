import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../src/client';

// Every real adapter that can serve all mandatory workflow roles.
const REAL_PROVIDER_KINDS = ['CODEX', 'CLAUDE_CODE'] as const;
const RUNTIME_PROVIDER_KEYS: Record<RealProviderKind, string> = {
  CODEX: 'codex',
  CLAUDE_CODE: 'claude-code',
};

export type RealProviderKind = (typeof REAL_PROVIDER_KINDS)[number];

export interface RealBootstrapConfig {
  adminEmail: string;
  adminPassword: string;
  organizationName: string;
  organizationSlug: string;
  providerKey: string;
  providerKind: RealProviderKind;
  providerModel: string;
}

const required = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

export const parseRealBootstrapEnv = (
  env: NodeJS.ProcessEnv = process.env,
): RealBootstrapConfig => {
  const adminEmail = required(env, 'ENGLOOP_BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const adminPassword = env.ENGLOOP_BOOTSTRAP_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('ENGLOOP_BOOTSTRAP_ADMIN_PASSWORD is required');
  if (adminPassword.length < 8) {
    throw new Error('ENGLOOP_BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw new Error('ENGLOOP_BOOTSTRAP_ADMIN_EMAIL must be a valid email address');
  }

  const organizationSlug = required(env, 'ENGLOOP_BOOTSTRAP_ORGANIZATION_SLUG').toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organizationSlug)) {
    throw new Error(
      'ENGLOOP_BOOTSTRAP_ORGANIZATION_SLUG must contain lowercase letters, numbers, and single hyphens only',
    );
  }

  const providerKey = required(env, 'ENGLOOP_BOOTSTRAP_PROVIDER_KEY').toLowerCase();
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(providerKey)) {
    throw new Error(
      'ENGLOOP_BOOTSTRAP_PROVIDER_KEY must contain lowercase letters, numbers, hyphens, or underscores',
    );
  }

  const rawKind = required(env, 'ENGLOOP_BOOTSTRAP_PROVIDER_KIND').toUpperCase();
  if (rawKind === 'MOCK') {
    throw new Error('ENGLOOP_BOOTSTRAP_PROVIDER_KIND must be a real provider, not MOCK');
  }
  if (!REAL_PROVIDER_KINDS.includes(rawKind as RealProviderKind)) {
    throw new Error(
      `ENGLOOP_BOOTSTRAP_PROVIDER_KIND must be one of: ${REAL_PROVIDER_KINDS.join(', ')}`,
    );
  }
  const expectedKey = RUNTIME_PROVIDER_KEYS[rawKind as RealProviderKind];
  if (providerKey !== expectedKey) {
    throw new Error(`ENGLOOP_BOOTSTRAP_PROVIDER_KEY must be ${expectedKey} for ${rawKind}`);
  }

  return {
    adminEmail,
    adminPassword,
    organizationName: required(env, 'ENGLOOP_BOOTSTRAP_ORGANIZATION_NAME'),
    organizationSlug,
    providerKey,
    providerKind: rawKind as RealProviderKind,
    providerModel: required(env, 'ENGLOOP_BOOTSTRAP_PROVIDER_MODEL'),
  };
};

export const hashBootstrapPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
};

export const verifyBootstrapPassword = (password: string, stored: string | null): boolean => {
  if (!stored) return false;
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};

export const bootstrapReal = async (
  prisma: PrismaClient,
  config: RealBootstrapConfig,
): Promise<{
  organization: { id: string; name: string; slug: string };
  owner: { id: string; email: string };
  provider: { id: string; key: string; kind: string; defaultModel: string | null };
  credentialState: 'process-environment';
}> => {
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.upsert({
      where: { slug: config.organizationSlug },
      create: {
        name: config.organizationName,
        slug: config.organizationSlug,
        defaultProviderKey: config.providerKey,
      },
      update: {
        name: config.organizationName,
        defaultProviderKey: config.providerKey,
      },
      select: { id: true, name: true, slug: true },
    });

    const existingOwner = await tx.user.findUnique({
      where: { email: config.adminEmail },
      select: { id: true, passwordHash: true },
    });
    const passwordHash = verifyBootstrapPassword(
      config.adminPassword,
      existingOwner?.passwordHash ?? null,
    )
      ? existingOwner?.passwordHash
      : hashBootstrapPassword(config.adminPassword);

    const owner = await tx.user.upsert({
      where: { email: config.adminEmail },
      create: {
        email: config.adminEmail,
        name: config.adminEmail.split('@')[0] || 'Owner',
        passwordHash,
      },
      update: { passwordHash },
      select: { id: true, email: true },
    });

    await tx.organizationMember.upsert({
      where: {
        organizationId_userId: { organizationId: organization.id, userId: owner.id },
      },
      create: { organizationId: organization.id, userId: owner.id, role: 'OWNER' },
      update: { role: 'OWNER' },
    });

    const provider = await tx.agentProvider.upsert({
      where: {
        organizationId_key: {
          organizationId: organization.id,
          key: config.providerKey,
        },
      },
      create: {
        organizationId: organization.id,
        key: config.providerKey,
        displayName: config.providerKey,
        kind: config.providerKind,
        enabled: true,
        defaultModel: config.providerModel,
        availableModels: [config.providerModel],
        healthy: false,
        lastHealthDetail: 'Awaiting worker health check.',
      },
      update: {
        displayName: config.providerKey,
        kind: config.providerKind,
        enabled: true,
        defaultModel: config.providerModel,
        availableModels: [config.providerModel],
      },
      select: { id: true, key: true, kind: true, defaultModel: true },
    });

    return {
      organization,
      owner,
      provider,
      credentialState: 'process-environment',
    };
  });
};

const main = async (): Promise<void> => {
  const config = parseRealBootstrapEnv();
  const prisma = createPrismaClient();
  try {
    const result = await bootstrapReal(prisma, config);
    process.stdout.write(
      [
        'EngLoop real bootstrap complete.',
        `Organization: ${result.organization.name} (${result.organization.id})`,
        `Owner: ${result.owner.email} (${result.owner.id})`,
        `Provider: ${result.provider.key} / ${result.provider.kind} / ${result.provider.defaultModel ?? 'default'} (${result.provider.id})`,
        `Provider credential: ${result.credentialState}`,
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
};

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/prisma/bootstrap-real.ts')) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Real bootstrap failed');
    process.exitCode = 1;
  });
}
