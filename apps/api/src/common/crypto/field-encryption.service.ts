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
 */
@Injectable()
export class FieldEncryptionService {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.key = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'hex');

    if (this.key.length !== 32) {
      throw new Error('FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes.');
    }
  }

  /** Returns `iv:authTag:ciphertext`, all base64url. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, {
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
    const parts = payload.split(':');

    if (parts.length !== 3) {
      throw new Error('Malformed ciphertext payload.');
    }

    const [ivPart, tagPart, dataPart] = parts as [string, string, string];

    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivPart, 'base64url'),
      { authTagLength: AUTH_TAG_LENGTH },
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
