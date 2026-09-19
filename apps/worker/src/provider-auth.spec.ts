import { describe, expect, it } from 'vitest';
import { claudeCodeCliAuth, codexCliAuth } from './provider-auth';

describe('codexCliAuth', () => {
  it('bills a configured OpenAI key ahead of the login stored in CODEX_HOME', () => {
    const auth = codexCliAuth({ OPENAI_API_KEY: 'sk-openai', CODEX_HOME: 'C:/Users/me/.codex' });

    expect(auth).toEqual({
      source: 'api-key',
      env: {
        CODEX_API_KEY: 'sk-openai',
        OPENAI_API_KEY: 'sk-openai',
        CODEX_HOME: 'C:/Users/me/.codex',
      },
    });
  });

  it('falls back to the codex login when no key is configured', () => {
    expect(codexCliAuth({ OPENAI_API_KEY: '  ', CODEX_HOME: 'C:/Users/me/.codex' })).toEqual({
      source: 'cli-login',
      env: { CODEX_HOME: 'C:/Users/me/.codex' },
    });
    expect(codexCliAuth({})).toEqual({ source: 'cli-login', env: {} });
  });
});

describe('claudeCodeCliAuth', () => {
  it('passes a configured Anthropic key, which headless Claude Code always uses', () => {
    expect(claudeCodeCliAuth({ ANTHROPIC_API_KEY: 'sk-ant' })).toEqual({
      source: 'api-key',
      env: { ANTHROPIC_API_KEY: 'sk-ant' },
    });
  });

  it('leaves the claude login in charge when no key is configured', () => {
    expect(claudeCodeCliAuth({ ANTHROPIC_API_KEY: '' })).toEqual({ source: 'cli-login', env: {} });
  });

  it('never receives the OpenAI key, and Codex never receives the Anthropic one', () => {
    const env = { OPENAI_API_KEY: 'sk-openai', ANTHROPIC_API_KEY: 'sk-ant' };

    expect(Object.values(claudeCodeCliAuth(env).env)).not.toContain('sk-openai');
    expect(Object.values(codexCliAuth(env).env)).not.toContain('sk-ant');
  });
});
