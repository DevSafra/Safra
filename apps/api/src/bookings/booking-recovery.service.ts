import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  BOOKING_VERIFICATION_ATTEMPTS,
  BOOKING_VERIFICATION_MINUTES,
  ERROR,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { bookingRecoveryMail, bookingVerificationMail } from '../mail/mail.templates.js';
import { badRequest, notFound } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/** SHA-256, for the same reason `BookingAccessService` uses it — see `bookingVerifications`. */
const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/**
 * EC-010 — «العميل أضاع رقم الحجز: يسترجعه بالبريد أو الهاتف بعد تحقق آمن».
 *
 * ## The whole design is in what «تحقق آمن» refuses to be
 *
 * An email address is not a secret. It is printed on invoices, forwarded between colleagues, and
 * sold in other companies' breaches. So the one thing this must never become is an ORACLE — type
 * an address, learn whether that person is travelling, where, and when. Rate-limiting does not fix
 * an oracle; it slows one down.
 *
 * Two tiers, and neither of them discloses anything to whoever asked:
 *
 * 1. **Self-service.** The customer names an address and SAFRA emails the references TO THAT
 *    ADDRESS. The disclosure goes to whoever controls the mailbox, which is the only party
 *    entitled to it. The API's answer is identical either way.
 * 2. **Staff-assisted.** A support agent holding a reference sends a code to the contact ON THE
 *    BOOKING, and the caller reads it back. That inverts the usual trust: the caller proves
 *    control of the channel BEFORE the record opens, rather than an agent reading out details for
 *    a caller to confirm.
 *
 * ## What is deliberately absent
 *
 * There is no lookup that takes an email or a telephone number and returns booking records. That
 * is the oracle, and Bashar ruled it out explicitly (2026-08-25). Knowledge-based verification —
 * «confirm your dates and the amount» — is absent for the same reason: anybody holding a forwarded
 * confirmation passes it, and it trains agents to volunteer details to prompt the caller.
 */
@Injectable()
export class BookingRecoveryService {
  private readonly logger = new Logger(BookingRecoveryService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Tier 1 — emails whatever references this address holds, and says nothing to the caller.
   *
   * ## The caller learns nothing, including whether anything was found
   *
   * The method returns void and the controller answers 202 regardless. A different status, a
   * different body, or even a measurably different response time would answer the question this
   * exists to refuse. The mail is sent AFTER the answer is decided, and a send failure is logged
   * rather than surfaced — an error that appears only for addresses with bookings is the oracle
   * again, wearing a 500.
   *
   * ## Bounded, and ordered so the newest is useful
   *
   * A customer with forty stays does not want forty numbers; the ones they are chasing are recent.
   * Ten, newest first — and a cancelled booking is included, because «which was the one I
   * cancelled» is a question people ask.
   */
  async recover(email: string): Promise<void> {
    const rows = await this.db.execute<{ reference: string; locale: string | null }>(sql`
      SELECT b.reference, u.preferred_locale AS locale
      FROM bookings b
      JOIN customer_profiles cp ON cp.id = b.customer_profile_id
      LEFT JOIN users u ON u.id = cp.user_id
      WHERE lower(cp.email) = lower(${email})
        AND b.deleted_at IS NULL
      ORDER BY b.created_at DESC
      LIMIT 10
    `);

    const mail = bookingRecoveryMail({
      to: email,
      references: rows.rows.map((row) => row.reference),
      locale: rows.rows[0]?.locale ?? 'ar',
    });

    try {
      await this.mail.send(mail);
    } catch (error) {
      /*
        Swallowed, and the address is NOT in the log line.

        A failure that reached the caller would distinguish the two cases — and a log line naming
        the address would put a customer's email in a file, which §14 and the redaction rules both
        forbid. The count is enough to notice a broken mailer.
      */
      this.logger.warn(
        `Booking recovery mail failed for one address (${rows.rows.length} reference(s)).`,
      );
      void error;
    }
  }

  /**
   * Tier 2, step one — send a code to the contact details ON the booking.
   *
   * The agent supplies the reference and nothing else. The destination is read from the booking,
   * never from the request: accepting an address here would let a caller name their own and
   * receive a code for a stranger's stay, which is the whole attack this is built against.
   *
   * The reply carries a MASKED destination — «g•••5@safra.test» — so the agent can say "I have
   * sent a code to the address ending in .test" without reading out an address they have not yet
   * established the caller owns.
   */
  async sendCode(
    reference: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<{ sentTo: string; expiresInMinutes: number }> {
    const rows = await this.db.execute<{
      id: string;
      email: string;
      locale: string | null;
    }>(sql`
      SELECT b.id, cp.email, u.preferred_locale AS locale
      FROM bookings b
      JOIN customer_profiles cp ON cp.id = b.customer_profile_id
      LEFT JOIN users u ON u.id = cp.user_id
      WHERE b.reference = ${reference} AND b.deleted_at IS NULL
      LIMIT 1
    `);

    const booking = rows.rows[0];

    if (!booking) throw notFound(ERROR.BOOKING_NOT_FOUND);

    /* `randomInt`, not `Math.random()` — this is a credential, however short-lived. */
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.db.execute(sql`
      INSERT INTO booking_verifications
        (booking_id, code_hash, channel, expires_at, requested_by_user_id)
      VALUES (${booking.id}::uuid, ${digest(code)}, 'email',
              now() + (${BOOKING_VERIFICATION_MINUTES}::int * INTERVAL '1 minute'),
              ${claims?.sub ?? null})
    `);

    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action: 'booking.verification_sent',
      subjectType: 'booking',
      subjectId: booking.id,
      /* The CHANNEL, never the address and never the code. */
      after: { channel: 'email' },
    });

    await this.mail.send(
      bookingVerificationMail({
        to: booking.email,
        reference,
        code,
        minutes: BOOKING_VERIFICATION_MINUTES,
        locale: booking.locale ?? 'ar',
      }),
    );

    return {
      sentTo: maskEmail(booking.email),
      expiresInMinutes: BOOKING_VERIFICATION_MINUTES,
    };
  }

  /**
   * Tier 2, step two — the caller read a code back, and it is either right or it is not.
   *
   * ## Attempts are counted on the ROW, not per request
   *
   * A support call has no rate limit of its own: the agent is holding the telephone and can type
   * as many guesses as the caller offers. Six digits is a million possibilities, so the ceiling is
   * what bounds the guessing — three, after which the code is spent and a new one must be sent,
   * which puts a fresh message in the customer's mailbox and makes a guessing campaign visible to
   * the person being attacked.
   *
   * ## One answer for every failure
   *
   * Wrong, expired, already used, too many attempts — all `BOOKING_VERIFICATION_FAILED`. Telling
   * an agent «that code expired» rather than «that code is wrong» would let somebody map which
   * codes had ever existed, and none of the distinctions helps the person on the call: in every
   * case the next step is to send another.
   */
  async verify(
    reference: string,
    code: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<{ reference: string; verifiedAt: string }> {
    const rows = await this.db.execute<{ id: string; booking_id: string }>(sql`
      UPDATE booking_verifications v
      SET consumed_at = now()
      FROM bookings b
      WHERE b.reference = ${reference}
        AND v.booking_id = b.id
        AND v.code_hash = ${digest(code)}
        AND v.consumed_at IS NULL
        AND v.expires_at > now()
        AND v.attempts < ${BOOKING_VERIFICATION_ATTEMPTS}
      RETURNING v.id, v.booking_id
    `);

    const verification = rows.rows[0];

    if (!verification) {
      /*
        A wrong guess costs an attempt on every LIVE code for this booking.

        Counted before the refusal is returned, and against the codes rather than the caller: an
        attacker who could reset the count by requesting a new code would have an unbounded budget,
        which is exactly what the ceiling exists to remove.
      */
      await this.db.execute(sql`
        UPDATE booking_verifications v
        SET attempts = v.attempts + 1
        FROM bookings b
        WHERE b.reference = ${reference}
          AND v.booking_id = b.id
          AND v.consumed_at IS NULL
          AND v.expires_at > now()
      `);

      throw badRequest(ERROR.BOOKING_VERIFICATION_FAILED);
    }

    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action: 'booking.verification_passed',
      subjectType: 'booking',
      subjectId: verification.booking_id,
    });

    return { reference, verifiedAt: new Date().toISOString() };
  }
}

/**
 * Enough of an address to recognise, not enough to learn.
 *
 * `guest5@safra.test` → `g•••5@safra.test`. The domain stays because it is what a customer
 * recognises — «yes, my work address» — and the local part is reduced to its ends, which is what
 * distinguishes two addresses somebody actually owns without disclosing one they do not.
 */
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');

  if (local.length <= 2) return `••@${domain}`;

  return `${local[0] ?? ''}•••${local[local.length - 1] ?? ''}@${domain}`;
}
