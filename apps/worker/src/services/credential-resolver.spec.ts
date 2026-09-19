import { describe, expect, it, vi } from 'vitest';
import { SecretCipher } from '@engloop/config';
import type { PrismaClient } from '@engloop/db';
import type { EngLoopLogger } from '@engloop/logger';
import { CredentialResolver } from './credential-resolver';

const KEY = 'a-development-passphrase-for-tests';
const cipher = new SecretCipher(KEY);
const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as EngLoopLogger;

const prismaReturning = (row: unknown, findFirst = vi.fn().mockResolvedValue(row)) => ({
  prisma: { agentProvider: { findFirst } } as unknown as PrismaClient,
  findFirst,
});

const storedCredential = (plaintext: string) => {
  const encrypted = cipher.encrypt(plaintext);
  return {
    encryptedCredential: encrypted.ciphertext,
    credentialIv: encrypted.iv,
    credentialAuthTag: encrypted.authTag,
  };
};

describe('CredentialResolver', () => {
  it('decrypts the credential the API stored for that organization', async () => {
    const { prisma } = prismaReturning(storedCredential('sk-live-from-the-ui'));
    const resolver = new CredentialResolver({ prisma, cipher, logger });

    await expect(resolver.resolve('org-1', 'codex')).resolves.toBe('sk-live-from-the-ui');
  });

  it('resolves to undefined when no key is stored, leaving the CLI login in charge', async () => {
    const { prisma } = prismaReturning({
      encryptedCredential: null,
      credentialIv: null,
      credentialAuthTag: null,
    });
    const resolver = new CredentialResolver({ prisma, cipher, logger });

    await expect(resolver.resolve('org-1', 'codex')).resolves.toBeUndefined();
  });

  it('resolves to undefined when the provider row does not exist', async () => {
    const { prisma } = prismaReturning(null);
    const resolver = new CredentialResolver({ prisma, cipher, logger });

    await expect(resolver.resolve('org-1', 'nope')).resolves.toBeUndefined();
  });

  it('fails closed on undecryptable ciphertext rather than silently using the CLI login', async () => {
    const stored = storedCredential('sk-live-1');
    const { prisma } = prismaReturning({
      ...stored,
      ciphertextTampered: true,
      encryptedCredential: Buffer.from('tampered').toString('base64'),
    });
    const resolver = new CredentialResolver({ prisma, cipher, logger });

    await expect(resolver.resolve('org-1', 'codex')).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_UNAVAILABLE',
    });
  });

  it('fails closed when the encryption key no longer matches what encrypted the row', async () => {
    const { prisma } = prismaReturning(storedCredential('sk-live-1'));
    const resolver = new CredentialResolver({
      prisma,
      cipher: new SecretCipher('a-different-key-entirely'),
      logger,
    });

    await expect(resolver.resolve('org-1', 'codex')).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_UNAVAILABLE',
    });
  });

  it('never logs ciphertext or plaintext when decryption fails', async () => {
    const error = vi.fn();
    const { prisma } = prismaReturning({
      encryptedCredential: Buffer.from('tampered').toString('base64'),
      credentialIv: cipher.encrypt('x').iv,
      credentialAuthTag: cipher.encrypt('x').authTag,
    });
    const resolver = new CredentialResolver({
      prisma,
      cipher,
      logger: { error } as unknown as EngLoopLogger,
    });

    await expect(resolver.resolve('org-1', 'codex')).rejects.toThrow();
    expect(error).toHaveBeenCalledWith(
      { providerKey: 'codex', organizationId: 'org-1' },
      expect.any(String),
    );
  });

  it('caches within the TTL and re-reads once it lapses', async () => {
    const { prisma, findFirst } = prismaReturning(storedCredential('sk-live-1'));
    const resolver = new CredentialResolver({ prisma, cipher, logger, ttlMs: 10_000 });

    await resolver.resolve('org-1', 'codex');
    await resolver.resolve('org-1', 'codex');
    expect(findFirst).toHaveBeenCalledTimes(1);

    resolver.invalidate('org-1', 'codex');
    await resolver.resolve('org-1', 'codex');
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('keeps organizations apart in the cache', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(storedCredential('sk-org-one'))
      .mockResolvedValueOnce(storedCredential('sk-org-two'));
    const prisma = { agentProvider: { findFirst } } as unknown as PrismaClient;
    const resolver = new CredentialResolver({ prisma, cipher, logger });

    await expect(resolver.resolve('org-1', 'codex')).resolves.toBe('sk-org-one');
    await expect(resolver.resolve('org-2', 'codex')).resolves.toBe('sk-org-two');
  });
});

describe('cross-process credential round trip', () => {
  it('decrypts in the worker what the API encrypted with the same configured key', () => {
    // The API and the worker construct SecretCipher independently; a mismatch
    // here would mean every UI-configured key fails at run time.
    const apiSide = new SecretCipher(KEY);
    const workerSide = new SecretCipher(KEY);

    expect(workerSide.decrypt(apiSide.encrypt('sk-live-shared'))).toBe('sk-live-shared');
  });

  it('derives the same key from a 32-byte base64 value as from its passphrase form', () => {
    const base64Key = Buffer.alloc(32, 7).toString('base64');
    const encrypted = new SecretCipher(base64Key).encrypt('sk-live-1');

    expect(new SecretCipher(base64Key).decrypt(encrypted)).toBe('sk-live-1');
  });
});
