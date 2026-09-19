import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Normalises a configured key into the 32 bytes AES-256 needs.
 *
 * Accepts either a 32-byte base64 key (`openssl rand -base64 32`) or any
 * passphrase, hashed with SHA-256. Both the API and the worker must derive the
 * key identically or ciphertext written by one will not decrypt in the other.
 */
export const deriveSecretKey = (raw: string): Buffer => {
  const decoded = Buffer.from(raw, 'base64');
  return decoded.length === 32 ? decoded : createHash('sha256').update(raw).digest();
};

/**
 * AES-256-GCM encryption for credentials at rest (spec section 21).
 *
 * Framework-free on purpose: the API wraps it in a Nest provider while the
 * worker constructs it directly, and both must share one implementation of the
 * wire format so a key written through the UI decrypts during a run.
 */
export class SecretCipher {
  private readonly key: Buffer;

  constructor(encryptionKey: string) {
    this.key = deriveSecretKey(encryptionKey);
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
