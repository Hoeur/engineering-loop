import { describe, expect, it } from 'vitest';
import {
  hashBootstrapPassword,
  parseRealBootstrapEnv,
  verifyBootstrapPassword,
} from '../prisma/bootstrap-real';

const validEnv = (): NodeJS.ProcessEnv => ({
  ENGLOOP_BOOTSTRAP_ADMIN_EMAIL: 'owner@example.com',
  ENGLOOP_BOOTSTRAP_ADMIN_PASSWORD: 'a-secure-password',
  ENGLOOP_BOOTSTRAP_ORGANIZATION_NAME: 'Example Engineering',
  ENGLOOP_BOOTSTRAP_ORGANIZATION_SLUG: 'example-engineering',
  ENGLOOP_BOOTSTRAP_PROVIDER_KEY: 'codex',
  ENGLOOP_BOOTSTRAP_PROVIDER_KIND: 'CODEX',
  ENGLOOP_BOOTSTRAP_PROVIDER_MODEL: 'gpt-5-codex',
});

describe('real bootstrap configuration', () => {
  it('requires an explicit non-mock provider configuration', () => {
    expect(parseRealBootstrapEnv(validEnv())).toMatchObject({
      adminEmail: 'owner@example.com',
      organizationSlug: 'example-engineering',
      providerKey: 'codex',
      providerKind: 'CODEX',
      providerModel: 'gpt-5-codex',
    });
  });

  it('refuses the mock provider', () => {
    expect(() =>
      parseRealBootstrapEnv({
        ...validEnv(),
        ENGLOOP_BOOTSTRAP_PROVIDER_KIND: 'MOCK',
      }),
    ).toThrow(/not MOCK/);
  });

  it('refuses provider kinds that have no registered runtime adapter', () => {
    expect(() =>
      parseRealBootstrapEnv({
        ...validEnv(),
        ENGLOOP_BOOTSTRAP_PROVIDER_KIND: 'CUSTOM_CLI',
      }),
    ).toThrow(/must be one of/);
  });

  it('accepts Claude Code with its runtime key', () => {
    expect(
      parseRealBootstrapEnv({
        ...validEnv(),
        ENGLOOP_BOOTSTRAP_PROVIDER_KIND: 'CLAUDE_CODE',
        ENGLOOP_BOOTSTRAP_PROVIDER_KEY: 'claude-code',
        ENGLOOP_BOOTSTRAP_PROVIDER_MODEL: 'sonnet',
      }),
    ).toEqual(expect.objectContaining({ providerKind: 'CLAUDE_CODE', providerKey: 'claude-code' }));
  });

  it('requires the runtime key that matches the selected adapter', () => {
    expect(() =>
      parseRealBootstrapEnv({ ...validEnv(), ENGLOOP_BOOTSTRAP_PROVIDER_KEY: 'custom-codex' }),
    ).toThrow(/must be codex/);
  });
});

describe('real bootstrap secrets', () => {
  it('uses the same scrypt password format as AuthService', () => {
    const hash = hashBootstrapPassword('a-secure-password');
    expect(hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(verifyBootstrapPassword('a-secure-password', hash)).toBe(true);
    expect(verifyBootstrapPassword('wrong-password', hash)).toBe(false);
  });
});
