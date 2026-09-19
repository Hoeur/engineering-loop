import type { AgentRole } from '@engloop/types';
import type { EngLoopLogger } from '@engloop/logger';
import {
  ProviderUnavailableError,
  type CodingAgentProvider,
  type ProviderHealth,
} from './provider';

/**
 * Role → provider resolution (spec section 9).
 *
 * Roles are never hardcoded to a vendor. The mapping is data, supplied per
 * organization/project, and falls back to a configured default provider.
 */
export type RoleProviderMap = Partial<Record<AgentRole, string>>;

export interface ResolveOptions {
  role: AgentRole;
  /** Project-level overrides beat organization-level ones. */
  overrides?: RoleProviderMap;
  organizationDefaults?: RoleProviderMap;
  fallbackProviderKey?: string;
}

export class AgentProviderRegistry {
  private readonly providers = new Map<string, CodingAgentProvider>();
  constructor(_logger?: EngLoopLogger) {}

  register(provider: CodingAgentProvider): this {
    this.providers.set(provider.key, provider);
    return this;
  }

  unregister(key: string): boolean {
    return this.providers.delete(key);
  }

  has(key: string): boolean {
    return this.providers.has(key);
  }

  get(key: string): CodingAgentProvider {
    const provider = this.providers.get(key);
    if (!provider) {
      throw new ProviderUnavailableError(key, 'provider is not registered in this process');
    }
    return provider;
  }

  list(): CodingAgentProvider[] {
    return [...this.providers.values()];
  }

  keys(): string[] {
    return [...this.providers.keys()];
  }

  /** Resolves the explicitly configured provider. Provider selection fails closed. */
  resolve(options: ResolveOptions): CodingAgentProvider {
    const candidates = [
      options.overrides?.[options.role],
      options.organizationDefaults?.[options.role],
      options.fallbackProviderKey,
    ].filter((value): value is string => Boolean(value));

    const key = candidates[0];
    if (!key) {
      throw new ProviderUnavailableError('unknown', `no provider is configured for ${options.role}`);
    }

    const provider = this.providers.get(key);
    if (!provider) {
      throw new ProviderUnavailableError(key, 'provider is not registered in this process');
    }
    if (!provider.capabilities.roles.includes(options.role)) {
      throw new ProviderUnavailableError(key, `provider cannot serve role ${options.role}`);
    }
    return provider;
  }

  async healthCheckAll(): Promise<Record<string, ProviderHealth>> {
    const entries = await Promise.all(
      this.list().map(async (provider) => {
        try {
          return [provider.key, await provider.healthCheck()] as const;
        } catch (error) {
          return [
            provider.key,
            {
              healthy: false,
              detail: error instanceof Error ? error.message : String(error),
              checkedAt: new Date().toISOString(),
            },
          ] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  }
}
