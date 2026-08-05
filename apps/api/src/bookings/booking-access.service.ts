import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { ERROR } from '@safra/contracts';
import { notFound } from '../common/errors/app-error.js';

/** 256 bits. Enough that guessing is not a threat model worth modelling. */
const TOKEN_BYTES = 32;

export interface BookingAccessSubject {
  readonly id: string;
  readonly reference: string;
  readonly status: string;
  readonly partnerId: string;
  readonly propertyId: string;
  readonly cityId: string;
  readonly customerProfileId: string;
}

/**
 * Lets a guest act on the booking they just made, and nobody else's.
 *
 * §4 allows booking with no account, so at the moment payment begins there is no
 * session to authorize against. The booking reference cannot fill that role:
 * §13.2 defines it as a year-scoped sequence (`BKG-2026-000042`), so live
 * references are trivially enumerable. Without this, "pay for booking X" would let
 * anyone pay for — and therefore read the price and guest details of — a stranger's
 * booking.
 *
 * The token is returned exactly once, when the booking is created, and only its
 * SHA-256 digest is stored. A read of the database therefore does not confer the
 * ability to act on bookings.
 *
 * SHA-256 rather than Argon2id is deliberate and is the opposite of the choice made
 * for passwords: this is a full-entropy random secret, so there is no dictionary to
 * slow an attacker down, and a deliberately slow hash would only tax the payment
 * path. Argon2id protects low-entropy human input; it buys nothing here.
 */
@Injectable()
export class BookingAccessService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Mints a token and stores its digest.
   *
   * Runs inside the caller's transaction so a booking can never be committed
   * without its token — a booking the guest cannot pay for is dead on arrival, and
   * they would have no way to recover it.
   */
  async mint(tx: Database, bookingId: string, expiresAt: Date): Promise<string> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');

    await tx.execute(sql`
      UPDATE bookings
      SET access_token_hash = ${digest(token)},
          access_token_expires_at = ${expiresAt.toISOString()}
      WHERE id = ${bookingId}
    `);

    return token;
  }

  /**
   * Resolves a reference + token to a booking, or 404s.
   *
   * Always 404, never 403 — matching the convention used across the API. A 403
   * would confirm that the reference names a real booking, which hands an
   * enumerator exactly the signal the token exists to deny them.
   */
  async authorize(reference: string, token: string): Promise<BookingAccessSubject> {
    const rows = await this.db.execute<{
      id: string;
      reference: string;
      status: string;
      partner_id: string;
      property_id: string;
      city_id: string;
      customer_profile_id: string;
      access_token_hash: string | null;
      expired: boolean;
    }>(sql`
      SELECT id, reference, status::text AS status, partner_id, property_id, city_id,
             customer_profile_id, access_token_hash,
             (access_token_expires_at IS NULL OR access_token_expires_at < now()) AS expired
      FROM bookings
      WHERE reference = ${reference} AND deleted_at IS NULL
      LIMIT 1
    `);

    const booking = rows.rows[0];

    /**
     * The comparison runs even when the booking or its hash is missing, against a
     * dummy of the same length. Returning early would make "no such reference"
     * measurably faster than "wrong token" and turn the endpoint into an oracle for
     * which references exist.
     */
    const stored = booking?.access_token_hash ?? digest('absent');
    const supplied = digest(token);
    const matches = equalsConstantTime(stored, supplied);

    if (!booking || !booking.access_token_hash || !matches || booking.expired) {
      throw notFound(ERROR.BOOKING_NOT_FOUND);
    }

    return {
      id: booking.id,
      reference: booking.reference,
      status: booking.status,
      partnerId: booking.partner_id,
      propertyId: booking.property_id,
      cityId: booking.city_id,
      customerProfileId: booking.customer_profile_id,
    };
  }

  /**
   * Invalidates the token once it has served its purpose.
   *
   * Called after capture: a credential that outlives the operation it authorizes is
   * a liability, and the payment window is over at that point anyway.
   */
  async revoke(tx: Database, bookingId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE bookings
      SET access_token_hash = NULL, access_token_expires_at = NULL
      WHERE id = ${bookingId}
    `);
  }
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function equalsConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  // Both are hex digests of fixed width, so unequal length means malformed input
  // rather than a near-miss; timingSafeEqual would throw on it.
  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}
