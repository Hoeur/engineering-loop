import { AgentProviderKind } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import { SecretCipher } from '@engloop/config';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { SecretsService } from '../../infrastructure/crypto/secrets.service';
import { AgentProvidersService } from './agent-providers.service';

const cipher = new SecretCipher('a-development-passphrase-for-tests');
const secrets = {
  encrypt: (plaintext: string) => cipher.encrypt(plaintext),
  decrypt: (secret: Parameters<typeof cipher.decrypt>[0]) => cipher.decrypt(secret),
  redact: (plaintext: string | null | undefined) => cipher.redact(plaintext),
} as SecretsService;

const audit = { recordSafe: vi.fn() } as never;

const baseDto = {
  organizationId: 'org-1',
  key: 'codex',
  displayName: 'Codex',
  kind: AgentProviderKind.CODEX,
  enabled: true,
  availableModels: [],
  clearCredential: false,
  configuration: {},
};

/** Prisma double whose `upsert` echoes back the row it was asked to write. */
const prismaWithUpsert = (upsert: ReturnType<typeof vi.fn>) =>
  ({ agentProvider: { upsert } }) as unknown as PrismaService;

const echoUpsert = (stored: Record<string, unknown> = {}) =>
  vi.fn().mockImplementation((args: { create: Record<string, unknown> }) =>
    Promise.resolve({
      id: 'provider-1',
      key: 'codex',
      kind: AgentProviderKind.CODEX,
      encryptedCredential: null,
      credentialIv: null,
      credentialAuthTag: null,
      ...args.create,
      ...stored,
    }),
  );

describe('AgentProvidersService credentials', () => {
  it('encrypts a submitted credential and never returns key material', async () => {
    const upsert = echoUpsert();
    const service = new AgentProvidersService(prismaWithUpsert(upsert), audit, secrets);

    const result = await service.upsert('org-1', 'OWNER', {
      ...baseDto,
      credential: 'sk-live-abcdefghijklmnop',
    } as never);

    const written = upsert.mock.calls[0][0].create;
    expect(written.encryptedCredential).toBeTruthy();
    expect(written.encryptedCredential).not.toContain('sk-live');
    expect(cipher.decrypt({
      ciphertext: written.encryptedCredential as string,
      iv: written.credentialIv as string,
      authTag: written.credentialAuthTag as string,
    })).toBe('sk-live-abcdefghijklmnop');

    // The response carries a preview only — no ciphertext, no plaintext.
    expect(result.credentialPreview).toBe('sk-••••••••mnop');
    expect(JSON.stringify(result)).not.toContain('sk-live-abcdefghijklmnop');
    expect(Object.keys(result)).not.toContain('encryptedCredential');
    expect(Object.keys(result)).not.toContain('credentialIv');
    expect(Object.keys(result)).not.toContain('credentialAuthTag');
  });

  it('leaves a stored key untouched when the field is omitted', async () => {
    const upsert = echoUpsert({ encryptedCredential: 'existing-ciphertext' });
    const service = new AgentProvidersService(prismaWithUpsert(upsert), audit, secrets);

    const result = await service.upsert('org-1', 'OWNER', {
      ...baseDto,
      displayName: 'Renamed',
    } as never);

    const call = upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('encryptedCredential');
    expect(call.create).not.toHaveProperty('encryptedCredential');
    expect(result.hasCredential).toBe(true);
    expect(result.credentialPreview).toBeNull();
  });

  it('clears the stored key on request, falling back to the CLI login', async () => {
    const upsert = echoUpsert();
    const service = new AgentProvidersService(prismaWithUpsert(upsert), audit, secrets);

    const result = await service.upsert('org-1', 'OWNER', {
      ...baseDto,
      clearCredential: true,
    } as never);

    expect(upsert.mock.calls[0][0].update).toMatchObject({
      encryptedCredential: null,
      credentialIv: null,
      credentialAuthTag: null,
    });
    expect(result.hasCredential).toBe(false);
    expect(result.credentialSource).toBe('cli-login');
  });

  it('reports the credential source a provider will actually use', async () => {
    const providers = [
      { key: 'codex', kind: AgentProviderKind.CODEX, encryptedCredential: 'cipher', _count: {} },
      { key: 'claude-code', kind: AgentProviderKind.CLAUDE_CODE, encryptedCredential: null, _count: {} },
      { key: 'mock', kind: AgentProviderKind.MOCK, encryptedCredential: null, _count: {} },
    ];
    const prisma = {
      agentProvider: { findMany: vi.fn().mockResolvedValue(providers) },
    } as unknown as PrismaService;
    const service = new AgentProvidersService(prisma, audit, secrets);

    const { items } = await service.list('org-1');

    expect(items.map((item) => item.credentialSource)).toEqual(['database', 'cli-login', 'none']);
    expect(items.map((item) => item.requiresCredential)).toEqual([true, true, false]);
    expect(JSON.stringify(items)).not.toContain('cipher');
  });

  it('refuses a credential for the mock provider, which never authenticates', async () => {
    const upsert = vi.fn();
    const service = new AgentProvidersService(prismaWithUpsert(upsert), audit, secrets);

    await expect(
      service.upsert('org-1', 'OWNER', {
        ...baseDto,
        key: 'mock',
        kind: AgentProviderKind.MOCK,
        credential: 'sk-should-not-be-stored',
      } as never),
    ).rejects.toMatchObject({ code: 'PROVIDER_CREDENTIAL_UNSUPPORTED' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('lets only owners and administrators write a credential', async () => {
    const upsert = vi.fn();
    const service = new AgentProvidersService(prismaWithUpsert(upsert), audit, secrets);

    await expect(
      service.upsert('org-1', 'MEMBER', { ...baseDto, credential: 'sk-live-1' } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(upsert).not.toHaveBeenCalled();
  });
});
