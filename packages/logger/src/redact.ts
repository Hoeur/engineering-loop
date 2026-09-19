/** Keys whose values must never reach a log sink. */
export const REDACTED_PATHS = Object.freeze([
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'api_key',
  'secret',
  'authorization',
  'privateKey',
  'encryptedValue',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.secret',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'env.OPENAI_API_KEY',
  'env.ANTHROPIC_API_KEY',
  'env.GEMINI_API_KEY',
  'env.AUTH_JWT_SECRET',
  'env.SECRETS_ENCRYPTION_KEY',
  'env.GITHUB_APP_PRIVATE_KEY',
]);

const SECRETISH = /(key|token|secret|password|credential|authorization)/i;

/**
 * Best-effort scrub for arbitrary objects that are about to be persisted as
 * audit metadata or agent-run payloads.
 */
export const scrubSecrets = <T>(input: T, depth = 0): T => {
  if (depth > 6 || input == null) return input;
  if (Array.isArray(input)) {
    return input.map((entry) => scrubSecrets(entry, depth + 1)) as unknown as T;
  }
  if (typeof input !== 'object') return input;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = SECRETISH.test(key) ? '[redacted]' : scrubSecrets(value, depth + 1);
  }
  return out as unknown as T;
};
