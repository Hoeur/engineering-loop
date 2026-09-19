import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypted-secret abstraction (spec section 21).
 *
 * Provider credentials and repository tokens are stored as AES-256-GCM
 * ciphertext. Plaintext never touches the database and is never serialised into
 * an API response — see `redact()`.
 */
@Injectable()
export class SecretsService {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    // Accepts either a 32-byte base64 key or any passphrase, normalised via SHA-256.
    const raw = config.env.SECRETS_ENCRYPTION_KEY;
    const decoded = Buffer.from(raw, 'base64');
    this.key = decoded.length === 32 ? decoded : createHash('sha256').update(raw).digest();
  }

  encrypt(plaintext: string): EncryptedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(secret: EncryptedSecret): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(secret.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Safe preview for the UI: never returns usable key material. */
  redact(plaintext: string | null | undefined): string | null {
    if (!plaintext) return null;
    if (plaintext.length <= 8) return '••••••••';
    return `${plaintext.slice(0, 3)}${'•'.repeat(8)}${plaintext.slice(-4)}`;
  }
}
