import { createHmac, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createGitHubAppJwt,
  createGitHubOAuthState,
  verifyGitHubOAuthState,
  verifyGitHubWebhook,
} from '../src';

describe('GitHub authentication helpers', () => {
  it('creates a verifiable, short-lived app JWT', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = createGitHubAppJwt({
      appId: '123',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      now: 1_700_000_000,
    });
    const [header, payload, signature] = token.split('.');
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toEqual({
      iat: 1_699_999_940,
      exp: 1_700_000_540,
      iss: '123',
    });
  });

  it('round-trips signed state and rejects tampering and expiry', () => {
    const created = createGitHubOAuthState({
      organizationId: 'org-1',
      userId: 'user-1',
      redirectUri: 'http://localhost:3001/projects/github/callback',
      secret: 'state-secret-long-enough',
      now: 100,
      nonce: 'nonce',
    });
    expect(
      verifyGitHubOAuthState({
        state: created.state,
        secret: 'state-secret-long-enough',
        now: 101,
      }),
    ).toMatchObject({ organizationId: 'org-1', userId: 'user-1' });
    expect(() =>
      verifyGitHubOAuthState({
        state: `${created.state}x`,
        secret: 'state-secret-long-enough',
        now: 101,
      }),
    ).toThrow('Invalid');
    expect(() =>
      verifyGitHubOAuthState({
        state: created.state,
        secret: 'state-secret-long-enough',
        now: 701,
      }),
    ).toThrow('Expired');
  });

  it('verifies the exact webhook bytes', () => {
    const body = Buffer.from('{"spacing": true}\n');
    const signature = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`;
    expect(verifyGitHubWebhook(body, signature, 'secret')).toBe(true);
    expect(verifyGitHubWebhook(Buffer.from('{"spacing":true}'), signature, 'secret')).toBe(false);
  });
});
