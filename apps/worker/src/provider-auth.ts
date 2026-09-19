/** Where a provider CLI gets its credentials from. */
export type CliAuthSource = 'api-key' | 'cli-login';

export interface CliAuth {
  source: CliAuthSource;
  /** Extra environment for every invocation of the CLI. Values are never logged. */
  env: Record<string, string>;
}

const configured = (value: string | undefined | null): string | undefined =>
  value?.trim() || undefined;

/**
 * Codex: the organization's stored API key wins over the `codex login` kept in
 * CODEX_HOME, so runs bill the API key and a ChatGPT plan's usage limit cannot
 * stop them. `codex exec` reads CODEX_API_KEY ahead of the stored login;
 * OPENAI_API_KEY goes along for CLI builds that predate it.
 *
 * `apiKey` is the decrypted per-organization credential (see CredentialResolver),
 * never a process environment variable. With no stored key the CLI falls back to
 * its own login.
 */
export const codexCliAuth = (apiKey: string | undefined | null, codexHome?: string): CliAuth => {
  const key = configured(apiKey);
  const home = configured(codexHome);
  return {
    source: key ? 'api-key' : 'cli-login',
    env: {
      ...(key ? { CODEX_API_KEY: key, OPENAI_API_KEY: key } : {}),
      ...(home ? { CODEX_HOME: home } : {}),
    },
  };
};

/**
 * Claude Code: headless (`-p`) runs always use ANTHROPIC_API_KEY when it is set,
 * ahead of the `claude` subscription login. With no stored key the CLI falls back
 * to that login.
 */
export const claudeCodeCliAuth = (apiKey: string | undefined | null): CliAuth => {
  const key = configured(apiKey);
  return {
    source: key ? 'api-key' : 'cli-login',
    env: key ? { ANTHROPIC_API_KEY: key } : {},
  };
};
