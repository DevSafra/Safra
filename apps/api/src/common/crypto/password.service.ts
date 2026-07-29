import { randomBytes } from 'node:crypto';

import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/**
 * Argon2id password hashing (project rule 1).
 *
 * Parameters follow OWASP's current guidance: 19 MiB of memory, 2 iterations,
 * 1 degree of parallelism. Memory cost is the important dial — it is what makes
 * GPU and ASIC cracking expensive, which raw iteration count does not.
 */
const ARGON2_OPTIONS = {
  // Argon2id — hybrid resistance to both side-channel and GPU attacks.
  algorithm: 2 as const,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} satisfies Parameters<typeof hash>[1];

@Injectable()
export class PasswordService {
  /**
   * A REAL Argon2id hash of a random secret, computed once on first use.
   *
   * It must be genuine: a hand-written fake fails to parse in microseconds, which
   * would defeat the entire purpose of verifyDummy() below.
   */
  private dummyHash: Promise<string> | undefined;

  async hash(plaintext: string): Promise<string> {
    return hash(plaintext, ARGON2_OPTIONS);
  }

  async verify(digest: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(digest, plaintext, ARGON2_OPTIONS);
    } catch {
      // A malformed or truncated hash in the database must read as "wrong
      // password", never as an unhandled 500 that confirms the account exists.
      return false;
    }
  }

  /**
   * Burns comparable CPU time when no user matched the supplied email.
   *
   * Without this, a missing account returns in microseconds while a real one takes
   * ~50 ms, and that gap alone enumerates the entire customer list. Called on the
   * not-found path so both branches cost roughly the same.
   */
  async verifyDummy(plaintext: string): Promise<false> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('hex'));
    await this.verify(await this.dummyHash, plaintext);
    return false;
  }
}
