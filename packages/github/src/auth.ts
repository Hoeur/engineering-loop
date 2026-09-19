import { createHmac, randomBytes, sign, timingSafeEqual } from 'node:crypto';
import type { GitHubOAuthStatePayload } from './types';

const encode = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

export const createGitHubAppJwt = (input: {
  appId: string;
  privateKey: string;
  now?: number;
}): string => {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const header = encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = encode(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: input.appId }));
  const unsigned = `${header}.${payload}`;
  const privateKey = input.privateKey.replace(/\\n/g, '\n');
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
};

const stateSignature = (encodedPayload: string, secret: string): string =>
  createHmac('sha256', secret).update(encodedPayload).digest('base64url');

export const createGitHubOAuthState = (input: {
  organizationId: string;
  userId: string;
  redirectUri: string;
  secret: string;
  now?: number;
  ttlSeconds?: number;
  nonce?: string;
}): { state: string; expiresAt: string } => {
  const issuedAt = input.now ?? Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + (input.ttlSeconds ?? 600);
  const payload: GitHubOAuthStatePayload = {
    organizationId: input.organizationId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    nonce: input.nonce ?? randomBytes(24).toString('base64url'),
    issuedAt,
    expiresAt,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return {
    state: `${encodedPayload}.${stateSignature(encodedPayload, input.secret)}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
};

export const verifyGitHubOAuthState = (input: {
  state: string;
  secret: string;
  now?: number;
}): GitHubOAuthStatePayload => {
  const [encodedPayload, suppliedSignature, extra] = input.state.split('.');
  if (!encodedPayload || !suppliedSignature || extra) throw new Error('Invalid GitHub OAuth state');
  const expected = Buffer.from(stateSignature(encodedPayload, input.secret));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error('Invalid GitHub OAuth state');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid GitHub OAuth state');
  }
  if (!isStatePayload(payload)) throw new Error('Invalid GitHub OAuth state');
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (payload.expiresAt < now || payload.issuedAt > now + 60) {
    throw new Error('Expired GitHub OAuth state');
  }
  return payload;
};

const isStatePayload = (value: unknown): value is GitHubOAuthStatePayload => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.organizationId === 'string' &&
    typeof record.userId === 'string' &&
    typeof record.redirectUri === 'string' &&
    typeof record.nonce === 'string' &&
    typeof record.issuedAt === 'number' &&
    typeof record.expiresAt === 'number'
  );
};

export const verifyGitHubWebhook = (
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean => {
  if (!signature?.startsWith('sha256=')) return false;
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
  );
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
};
