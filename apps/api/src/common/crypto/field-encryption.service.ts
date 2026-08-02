import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { ENV, type Env } from '../../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, the GCM standard
const AUTH_TAG_LENGTH = 16;

/**
 * Authenticated encryption for the few columns that must not be readable from a
 * database dump: staff TOTP seeds and partner payout account numbers.
 *
 * GCM is chosen over CBC because it is authenticated — ciphertext that has been
 * tampered with fails to decrypt rather than silently yielding altered plaintext.
 * For a bank account number, that distinction is the whole point.
 *
 * A fresh random IV per encryption is mandatory: reusing an IV with the same key
 * in GCM leaks the keystream and can expose the authentication key itself.
 *
 * ## Key rotation (S-6)
 *
 * Encryption always uses the CURRENT key. Decryption tries the current key first and
 * then `FIELD_ENCRYPTION_KEY_PREVIOUS` if one is configured.
 *
 * Without that fallback, rotating the key made every stored TOTP secret
 * undecryptable and locked every staff account out of the console simultaneously —
 * with no way back, because recovery is circular when the super admin is locked out
 * too. In practice that made the key unrotatable, which is not an acceptable property
 * for the key protecting second factors.
 *
 * There is no key identifier in the ciphertext. Adding one would change the stored
 * format and require migrating every existing row before rotation could work at all —
 * a chicken-and-egg problem. Trying two keys costs one failed GCM tag check on
 * not-yet-migrated values, which is microseconds and only until re-encryption
 * completes.
 */
/** What `decryptForRotation` reports back to a caller that can re-encrypt. */
export interface DecryptedField {
  readonly plaintext: string;
  /**
   * True when the value only decrypted with the retired key, so it is still stored
   * under it. A caller that can write should re-encrypt and save.
   */
  readonly needsReEncryption: boolean;
}

@Injectable()
export class FieldEncryptionService {
  /** Current key first; any retired key after it. Encryption always uses [0]. */
  private readonly keys: readonly Buffer[];

  constructor(@Inject(ENV) env: Env) {
    const current = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'hex');

    if (current.length !== 32) {
      throw new Error('FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes.');
    }

    const keys = [current];

    if (env.FIELD_ENCRYPTION_KEY_PREVIOUS) {
      const previous = Buffer.from(env.FIELD_ENCRYPTION_KEY_PREVIOUS, 'hex');

      if (previous.length !== 32) {
        throw new Error('FIELD_ENCRYPTION_KEY_PREVIOUS must decode to exactly 32 bytes.');
      }

      keys.push(previous);
    }

    this.keys = keys;
  }

  /** Whether a retired key is currently accepted for decryption. */
  get hasPreviousKey(): boolean {
    return this.keys.length > 1;
  }

  /** Returns `iv:authTag:ciphertext`, all base64url. Always the CURRENT key. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.keys[0] as Buffer, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return [
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(payload: string): string {
    return this.decryptForRotation(payload).plaintext;
  }

  /**
   * Decrypts, and says whether the value is still under the retired key.
   *
   * Callers that can write should re-encrypt when `needsReEncryption` is true, which
   * migrates secrets as they are used and lets the old key eventually be removed.
   * `pnpm rotate:encryption-key` finishes the ones nobody touches.
   */
  decryptForRotation(payload: string): DecryptedField {
    const parts = payload.split(':');

    if (parts.length !== 3) {
      throw new Error('Malformed ciphertext payload.');
    }

    const [ivPart, tagPart, dataPart] = parts as [string, string, string];
    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    const data = Buffer.from(dataPart, 'base64url');

    for (const [index, key] of this.keys.entries()) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv, {
          authTagLength: AUTH_TAG_LENGTH,
        });
        decipher.setAuthTag(tag);

        const plaintext = Buffer.concat([
          decipher.update(data),
          decipher.final(),
        ]).toString('utf8');

        return { plaintext, needsReEncryption: index > 0 };
      } catch {
        /**
         * A GCM tag mismatch is indistinguishable from "wrong key", so the only way
         * to tell is to try the next one. Swallowed per key and re-thrown once below
         * if none work — never reported per key, which would leak which key matched.
         */
      }
    }

    throw new Error(
      'Unable to decrypt: no configured key matches this value. ' +
        'Check FIELD_ENCRYPTION_KEY, and FIELD_ENCRYPTION_KEY_PREVIOUS if rotating.',
    );
  }
}
