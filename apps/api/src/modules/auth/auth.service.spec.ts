import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService password handling', () => {
  it('produces a salted scrypt hash that verifies', () => {
    const hash = AuthService.hashPassword('engloop-dev-password');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(AuthService.verifyPassword('engloop-dev-password', hash)).toBe(true);
  });

  it('rejects the wrong password', () => {
    const hash = AuthService.hashPassword('correct-horse');
    expect(AuthService.verifyPassword('battery-staple', hash)).toBe(false);
  });

  it('salts each hash independently', () => {
    expect(AuthService.hashPassword('same')).not.toBe(AuthService.hashPassword('same'));
  });

  it('refuses a missing or malformed stored hash', () => {
    expect(AuthService.verifyPassword('anything', null)).toBe(false);
    expect(AuthService.verifyPassword('anything', 'plaintext')).toBe(false);
    expect(AuthService.verifyPassword('anything', 'md5$salt$digest')).toBe(false);
  });
});
