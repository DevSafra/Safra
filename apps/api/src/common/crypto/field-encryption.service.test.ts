import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { Env } from '../../config/env.js';
import { FieldEncryptionService } from './field-encryption.service.js';

/**
 * Field encryption and key rotation (future-work S-6).
 *
 * The property that matters is the one whose absence made the key unrotatable:
 * a value encrypted under the retired key must still decrypt after the key changes,
 * and must be identifiable as needing to be rewritten. Without both, rotating
 * `FIELD_ENCRYPTION_KEY` locks every staff account out of the console at once.
 */
describe('FieldEncryptionService', () => {
  const KEY_A = randomBytes(32).toString('hex');
  const KEY_B = randomBytes(32).toString('hex');

  const service = (current: string, previous?: string) =>
    new FieldEncryptionService({
      FIELD_ENCRYPTION_KEY: current,
      ...(previous ? { FIELD_ENCRYPTION_KEY_PREVIOUS: previous } : {}),
    } as Env);

  describe('round trip', () => {
    it('decrypts what it encrypted', () => {
      const crypto = service(KEY_A);

      expect(crypto.decrypt(crypto.encrypt('JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP');
    });

    /** A fixed IV in GCM leaks the keystream; two ciphertexts must never match. */
    it('produces different ciphertext each time', () => {
      const crypto = service(KEY_A);

      expect(crypto.encrypt('same')).not.toBe(crypto.encrypt('same'));
    });

    /** GCM is authenticated: tampering must fail, not yield altered plaintext. */
    it('refuses ciphertext that has been altered', () => {
      const crypto = service(KEY_A);
      const [iv, tag, data] = crypto.encrypt('secret').split(':') as [
        string,
        string,
        string,
      ];
      const flipped = `${data.slice(0, -2)}${data.slice(-2) === 'AA' ? 'AB' : 'AA'}`;

      expect(() => crypto.decrypt(`${iv}:${tag}:${flipped}`)).toThrow();
    });

    it('rejects a malformed payload', () => {
      expect(() => service(KEY_A).decrypt('not-a-payload')).toThrow(/malformed/i);
    });

    it('rejects a key that is not 32 bytes', () => {
      expect(() => service('abcd')).toThrow();
    });
  });

  describe('rotation', () => {
    /** The defect, pinned: without a previous key this threw and locked everyone out. */
    it('still decrypts a value written under the retired key', () => {
      const before = service(KEY_A).encrypt('JBSWY3DPEHPK3PXP');
      const after = service(KEY_B, KEY_A);

      expect(after.decrypt(before)).toBe('JBSWY3DPEHPK3PXP');
    });

    it('reports a retired-key value as needing re-encryption', () => {
      const before = service(KEY_A).encrypt('secret');

      expect(service(KEY_B, KEY_A).decryptForRotation(before)).toEqual({
        plaintext: 'secret',
        needsReEncryption: true,
      });
    });

    it('does not flag a value already under the current key', () => {
      const rotated = service(KEY_B, KEY_A);

      expect(rotated.decryptForRotation(rotated.encrypt('secret'))).toEqual({
        plaintext: 'secret',
        needsReEncryption: false,
      });
    });

    /** New writes must use the new key, or rotation never finishes. */
    it('always encrypts with the current key', () => {
      const rotated = service(KEY_B, KEY_A);
      const fresh = rotated.encrypt('secret');

      // Readable by a service holding only the NEW key: proof it used that one.
      expect(service(KEY_B).decrypt(fresh)).toBe('secret');
    });

    it('reports whether a retired key is configured', () => {
      expect(service(KEY_A).hasPreviousKey).toBe(false);
      expect(service(KEY_B, KEY_A).hasPreviousKey).toBe(true);
    });

    /**
     * When neither key works the message must name the variables. The failure this
     * replaced said "Unsupported state or unable to authenticate data", which sent an
     * operator looking at the database rather than the configuration.
     */
    it('names the environment variables when no key matches', () => {
      const orphan = service(randomBytes(32).toString('hex')).encrypt('secret');

      expect(() => service(KEY_B, KEY_A).decrypt(orphan)).toThrow(/FIELD_ENCRYPTION_KEY/);
    });

    it('does not reveal which key matched', () => {
      const orphan = service(randomBytes(32).toString('hex')).encrypt('secret');
      const message = (() => {
        try {
          service(KEY_B, KEY_A).decrypt(orphan);
          return '';
        } catch (error) {
          return (error as Error).message;
        }
      })();

      expect(message).not.toMatch(/current key|previous key|index/i);
    });
  });
});
