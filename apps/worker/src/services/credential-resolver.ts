import type { SecretCipher } from '@engloop/config';
import type { PrismaClient } from '@engloop/db';
import type { EngLoopLogger } from '@engloop/logger';
import { ProviderUnavailableError } from '@engloop/agent-sdk';

interface CredentialResolverDeps {
  prisma: PrismaClient;
  cipher: SecretCipher;
  logger: EngLoopLogger;
  /** How long a decrypted key is reused before re-reading the row. */
  ttlMs?: number;
}

interface CacheEntry {
  value: string | undefined;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;

/**
 * Resolves a provider's API key for one organization (spec section 21).
 *
 * Credentials are configured in the UI and stored as AES-256-GCM ciphertext on
 * `agent_providers`; this is the only place the worker turns them back into
 * plaintext. A provider with no stored key resolves to `undefined`, which leaves
 * the CLI running on its own login — the process environment is never consulted.
 *
 * Decryption failures fail closed: a wrong or rotated SECRETS_ENCRYPTION_KEY must
 * stop the run loudly rather than silently downgrade to the CLI login and bill a
 * subscription the operator did not intend to use.
 */
export class CredentialResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(private readonly deps: CredentialResolverDeps) {
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  }

  private static cacheKey(organizationId: string, providerKey: string): string {
    return `${organizationId}::${providerKey}`;
  }

  async resolve(organizationId: string, providerKey: string): Promise<string | undefined> {
    const cacheKey = CredentialResolver.cacheKey(organizationId, providerKey);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const provider = await this.deps.prisma.agentProvider.findFirst({
      where: { organizationId, key: providerKey },
      select: { encryptedCredential: true, credentialIv: true, credentialAuthTag: true },
    });

    const value = provider ? this.decryptRow(providerKey, organizationId, provider) : undefined;
    this.cache.set(cacheKey, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  private decryptRow(
    providerKey: string,
    organizationId: string,
    row: {
      encryptedCredential: string | null;
      credentialIv: string | null;
      credentialAuthTag: string | null;
    },
  ): string | undefined {
    const { encryptedCredential, credentialIv, credentialAuthTag } = row;
    if (!encryptedCredential || !credentialIv || !credentialAuthTag) return undefined;

    try {
      return this.deps.cipher.decrypt({
        ciphertext: encryptedCredential,
        iv: credentialIv,
        authTag: credentialAuthTag,
      });
    } catch {
      // Never log the ciphertext or the cause, which can echo key material.
      this.deps.logger.error(
        { providerKey, organizationId },
        'stored provider credential could not be decrypted; check SECRETS_ENCRYPTION_KEY',
      );
      throw new ProviderUnavailableError(
        providerKey,
        'its stored credential could not be decrypted (SECRETS_ENCRYPTION_KEY may have changed)',
      );
    }
  }

  /** Drops cached keys so the next run re-reads them. */
  invalidate(organizationId?: string, providerKey?: string): void {
    if (organizationId && providerKey) {
      this.cache.delete(CredentialResolver.cacheKey(organizationId, providerKey));
      return;
    }
    this.cache.clear();
  }
}
