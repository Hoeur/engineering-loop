import { describe, expect, it } from 'vitest';
import { SecretsService } from './secrets.service';
import type { AppConfigService } from '../config/config.service';

const service = new SecretsService({
  env: { SECRETS_ENCRYPTION_KEY: 'a-development-passphrase-for-tests' },
} as AppConfigService);

describe('SecretsService', () => {
  it('round-trips a secret', () => {
    const encrypted = service.encrypt('sk-live-123456789');
    expect(encrypted.ciphertext).not.toContain('sk-live');
    expect(service.decrypt(encrypted)).toBe('sk-live-123456789');
  });

  it('uses a fresh IV each time, so identical plaintext yields different ciphertext', () => {
    const a = service.encrypt('same');
    const b = service.encrypt('same');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    const encrypted = service.encrypt('sensitive');
    const tampered = { ...encrypted, ciphertext: Buffer.from('nonsense').toString('base64') };
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('redacts a secret without leaking usable key material', () => {
    const redacted = service.redact('sk-live-abcdefghijklmnop');
    expect(redacted).toBe('sk-••••••••mnop');
    expect(redacted).not.toContain('abcdefghij');
  });

  it('redacts short values entirely and passes null through', () => {
    expect(service.redact('short')).toBe('••••••••');
    expect(service.redact(null)).toBeNull();
  });
});
