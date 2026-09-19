import { describe, expect, it } from 'vitest';
import { claudeCodeCliAuth, codexCliAuth } from './provider-auth';

describe('codexCliAuth', () => {
  it('bills the stored OpenAI key ahead of the login kept in CODEX_HOME', () => {
    const auth = codexCliAuth('sk-openai', 'C:/Users/me/.codex');

    expect(auth).toEqual({
      source: 'api-key',
      env: {
        CODEX_API_KEY: 'sk-openai',
        OPENAI_API_KEY: 'sk-openai',
        CODEX_HOME: 'C:/Users/me/.codex',
      },
    });
  });

  it('falls back to the codex login when no key is stored', () => {
    expect(codexCliAuth('  ', 'C:/Users/me/.codex')).toEqual({
      source: 'cli-login',
      env: { CODEX_HOME: 'C:/Users/me/.codex' },
    });
    expect(codexCliAuth(undefined)).toEqual({ source: 'cli-login', env: {} });
    expect(codexCliAuth(null)).toEqual({ source: 'cli-login', env: {} });
  });
});

describe('claudeCodeCliAuth', () => {
  it('passes the stored Anthropic key, which headless Claude Code always uses', () => {
    expect(claudeCodeCliAuth('sk-ant')).toEqual({
      source: 'api-key',
      env: { ANTHROPIC_API_KEY: 'sk-ant' },
    });
  });

  it('leaves the claude login in charge when no key is stored', () => {
    expect(claudeCodeCliAuth('')).toEqual({ source: 'cli-login', env: {} });
    expect(claudeCodeCliAuth(undefined)).toEqual({ source: 'cli-login', env: {} });
  });

  it('gives each CLI only its own key', () => {
    expect(Object.values(claudeCodeCliAuth('sk-ant').env)).not.toContain('sk-openai');
    expect(Object.values(codexCliAuth('sk-openai').env)).not.toContain('sk-ant');
  });
});
