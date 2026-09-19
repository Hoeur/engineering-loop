import type { CliAuth } from '../provider-auth';

/**
 * Bridges async credential resolution to the SDK's synchronous `env` callback.
 *
 * `CodingAgentProvider` instances are singletons created once in the composition
 * root, but `cli-agent.ts` calls `options.env?.()` lazily at spawn time. Reading
 * the credential from this store at that moment is what lets one registered
 * provider serve several organizations with different keys.
 *
 * The executor primes a key before `startRun` and clears it in a `finally`, so a
 * credential is only readable while its own run is spawning.
 */
export class ProviderCredentialStore {
  private readonly active = new Map<string, CliAuth>();

  set(providerKey: string, auth: CliAuth): void {
    this.active.set(providerKey, auth);
  }

  /** The environment the CLI should be spawned with; empty when nothing is primed. */
  env(providerKey: string): Record<string, string> {
    return { ...(this.active.get(providerKey)?.env ?? {}) };
  }

  source(providerKey: string): CliAuth['source'] | undefined {
    return this.active.get(providerKey)?.source;
  }

  clear(providerKey: string): void {
    this.active.delete(providerKey);
  }
}
