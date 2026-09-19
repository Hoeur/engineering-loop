import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  AUTH_JWT_SECRET: 'a-secret-that-is-long-enough',
  SECRETS_ENCRYPTION_KEY: 'another-long-enough-secret-value',
};

describe('environment contract', () => {
  it('applies documented defaults', () => {
    const env = parseEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.AGENT_DEFAULT_PROVIDER).toBe('codex');
    expect(env.AGENT_ENABLE_MOCK).toBe(false);
    expect(env.AGENT_MAX_REVIEW_CYCLES).toBe(3);
  });

  it('fails fast, listing every problem at once', () => {
    try {
      parseEnv({});
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(issues.length).toBeGreaterThanOrEqual(3);
      expect(issues.join(' ')).toContain('DATABASE_URL');
    }
  });

  it('rejects a weak signing secret', () => {
    expect(() => parseEnv({ ...base, AUTH_JWT_SECRET: 'short' })).toThrow(EnvValidationError);
  });

  it('parses booleans from the strings a .env file actually contains', () => {
    expect(parseEnv({ ...base, LOG_PRETTY: 'true' }).LOG_PRETTY).toBe(true);
    expect(parseEnv({ ...base, LOG_PRETTY: 'no' }).LOG_PRETTY).toBe(false);
    expect(parseEnv({ ...base, LOG_PRETTY: '1' }).LOG_PRETTY).toBe(true);
    expect(parseEnv({ ...base, AGENT_ENABLE_MOCK: 'false' }).AGENT_ENABLE_MOCK).toBe(false);
  });

  it('parses comma-separated lists', () => {
    const env = parseEnv({ ...base, COMMAND_ALLOWLIST: 'pnpm, git ,node' });
    expect(env.COMMAND_ALLOWLIST).toEqual(['pnpm', 'git', 'node']);
  });

  it('coerces numeric strings', () => {
    expect(parseEnv({ ...base, API_PORT: '5001' }).API_PORT).toBe(5001);
  });

  it('allows GitHub integration to remain fully disabled', () => {
    expect(
      parseEnv({ ...base, GITHUB_APP_ID: '', GITHUB_APP_PRIVATE_KEY: '' }).GITHUB_APP_ID,
    ).toBeUndefined();
  });

  it('allows incomplete GitHub configuration locally but rejects it in production', () => {
    expect(parseEnv({ ...base, GITHUB_APP_ID: '123' }).GITHUB_APP_ID).toBe('123');
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'production', GITHUB_APP_ID: '123' }),
    ).toThrow(EnvValidationError);
  });

  it('rejects a complete GitHub configuration containing placeholders', () => {
    expect(() =>
      parseEnv({
        ...base,
        GITHUB_APP_ID: '123',
        GITHUB_APP_SLUG: 'your-app',
        GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
        GITHUB_APP_CLIENT_ID: 'client',
        GITHUB_APP_CLIENT_SECRET: 'client-secret',
        GITHUB_WEBHOOK_SECRET: 'w'.repeat(32),
        GITHUB_OAUTH_STATE_SECRET: 's'.repeat(32),
        GITHUB_OAUTH_CALLBACK_URL: 'http://localhost:3001/projects/github/callback',
      }),
    ).toThrow(EnvValidationError);
  });
});
