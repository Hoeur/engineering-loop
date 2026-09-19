import { Injectable } from '@nestjs/common';
import { SecretCipher, type EncryptedSecret } from '@engloop/config';
import { AppConfigService } from '../config/config.service';

export type { EncryptedSecret };

/**
 * Encrypted-secret abstraction (spec section 21).
 *
 * Provider credentials and repository tokens are stored as AES-256-GCM
 * ciphertext. Plaintext never touches the database and is never serialised into
 * an API response — see `redact()`.
 *
 * The cipher itself lives in @engloop/config so the worker, which decrypts these
 * same rows at run time, shares one implementation of the wire format.
 */
@Injectable()
export class SecretsService {
  private readonly cipher: SecretCipher;

  constructor(config: AppConfigService) {
    this.cipher = new SecretCipher(config.env.SECRETS_ENCRYPTION_KEY);
  }

  encrypt(plaintext: string): EncryptedSecret {
    return this.cipher.encrypt(plaintext);
  }

  decrypt(secret: EncryptedSecret): string {
    return this.cipher.decrypt(secret);
  }

  /** Safe preview for the UI: never returns usable key material. */
  redact(plaintext: string | null | undefined): string | null {
    return this.cipher.redact(plaintext);
  }
}
