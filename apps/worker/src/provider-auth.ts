import type { Env } from '@engloop/config';

/** Where a provider CLI gets its credentials from. */
export type CliAuthSource = 'api-key' | 'cli-login';

export interface CliAuth {
  source: CliAuthSource;
  /** Extra environment for every invocation of the CLI. Values are never logged. */
  env: Record<string, string>;
}

type ProviderCredentials = Pick<Env, 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'CODEX_HOME'>;

const configured = (value: string | undefined): string | undefined => value?.trim() || undefined;

/**
 * Codex: a configured OPENAI_API_KEY wins over the `codex login` stored in
 * CODEX_HOME, so runs bill the API key and a ChatGPT plan's usage limit cannot
 * stop them. `codex exec` reads CODEX_API_KEY ahead of the stored login;
 * OPENAI_API_KEY goes along for CLI builds that predate it. Clear the key to run
 * on the login instead.
 */
export const codexCliAuth = (env: ProviderCredentials): CliAuth => {
  const apiKey = configured(env.OPENAI_API_KEY);
  const home = configured(env.CODEX_HOME);
  return {
    source: apiKey ? 'api-key' : 'cli-login',
    env: {
      ...(apiKey ? { CODEX_API_KEY: apiKey, OPENAI_API_KEY: apiKey } : {}),
      ...(home ? { CODEX_HOME: home } : {}),
    },
  };
};

/**
 * Claude Code: headless (`-p`) runs always use ANTHROPIC_API_KEY when it is set,
 * ahead of the `claude` subscription login. Clear the key to run on the login.
 */
export const claudeCodeCliAuth = (env: ProviderCredentials): CliAuth => {
  const apiKey = configured(env.ANTHROPIC_API_KEY);
  return {
    source: apiKey ? 'api-key' : 'cli-login',
    env: apiKey ? { ANTHROPIC_API_KEY: apiKey } : {},
  };
};
