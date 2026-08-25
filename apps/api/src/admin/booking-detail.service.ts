import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { ERROR } from '@safra/contracts';
import { notFound } from '../common/errors/app-error.js';
import { actorName } from '../common/actor-name.sql.js';
import { AuditService } from '../common/audit/audit.service.js';
import { allowedTransitions, type BookingStatus } from '../bookings/booking-state.js';

/**
 * Renders a `timestamptz` as an explicit UTC ISO-8601 string.
 *
 * `column::text` formats in the SESSION's timezone, so the same row reads differently
 * depending on the server's `TimeZone` setting. It happens to be correct while that is
 * `Etc/UTC`, which makes the bug invisible until a managed instance defaults to
 * something else — and then every timestamp on the screen is silently offset while
 * still labelled UTC. "Was the partner late?" must not depend on server configuration.
 *
 * The argument is a fixed column reference chosen by this file, never external input.
 */
function utc(column: string) {
  return sql.raw(
    `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  );
}

/**
 * One booking, everything a support agent needs (SRS §9.4).
 *
 * §9.4 asks for the full timeline, the money, and the parties on one screen. The
 * point is that a customer calling about a booking gets an answer from one place
 * rather than the agent piecing it together from four.
 *
 * ## Payment data is separated from the rest on purpose
 *
 * §4 gives support agents bookings, messages and disputes but NOT payment detail,
 * and §7.2 forbids showing any partner customer payment data. So the payment section
 * is populated only for callers holding `PAYMENT_READ` — finance and super admin —
 * and is simply absent otherwise. Absent rather than redacted: a row of asterisks
 * still tells you a payment exists and how many there were.
 */
@Injectable()
export class BookingDetailService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async detail(reference: string, claims: AccessTokenClaims | undefined) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT b.id, b.reference, b.status::text AS status,
             b.check_in::text, b.check_out::text, b.nights,
             b.guests_adults, b.guests_children, b.guests_infants,
             b.base_amount::text, b.customer_fee_amount::text,
             b.partner_commission_amount::text, b.wallet_amount::text,
             b.total_amount::text, b.partner_payable_amount::text,
             b.total_syp::text, b.fx_rate_to_syp::text,
             ${utc('b.paid_at')} AS paid_at,
             ${utc('b.confirmation_deadline_at')} AS confirmation_deadline_at,
             ${utc('b.confirmed_at')} AS confirmed_at,
             ${utc('b.cancelled_at')} AS cancelled_at,
             ${utc('b.created_at')} AS created_at,
             b.cancellation_reason,
             cur.code AS currency_code,
             cp.reference AS customer_reference, cp.full_name AS customer_name,
             cp.email AS customer_email, cp.phone AS customer_phone,
             cp.is_guest AS customer_is_guest,
             p.reference AS partner_reference, p.display_name AS partner_name,
             p.phone AS partner_phone,
             pr.reference AS property_reference,
             coalesce(pr.name_ar, pr.name_en) AS property_name,
             coalesce(u.name_ar, u.name_en)   AS unit_name,
             ci.name_ar AS city_name
      FROM bookings b
      JOIN currencies cur       ON cur.id = b.currency_id
      JOIN customer_profiles cp ON cp.id = b.customer_profile_id
      JOIN partners p           ON p.id = b.partner_id
      JOIN properties pr        ON pr.id = b.property_id
      JOIN units u              ON u.id = b.unit_id
      JOIN cities ci            ON ci.id = b.city_id
      WHERE b.reference = ${reference} AND b.deleted_at IS NULL
    `);

    const booking = rows.rows[0];
    if (!booking) throw notFound(ERROR.BOOKING_NOT_FOUND);

    const bookingId = booking['id'] as string;

    /**
     * The timeline. Append-only by trigger, so this is the authoritative history of
     * what happened to the booking — not a reconstruction from mutable columns.
     */
    const timeline = await this.db.execute<{
      event_type: string;
      actor_type: string;
      actor_email: string | null;
      payload: unknown;
      created_at: string;
    }>(sql`
      SELECT t.event_type, t.actor_type,
             ${actorName(sql`us.email`, sql`us.role`)} AS actor_email, t.payload,
             ${utc('t.created_at')} AS created_at
      FROM timeline_events t
      LEFT JOIN users us ON us.id = t.actor_user_id
      WHERE t.subject_type = 'booking' AND t.subject_id = ${bookingId}
      ORDER BY t.created_at ASC
    `);

    const canSeePayments = (claims?.permissions ?? []).includes('payment.read');
    /*
      Reading the notes takes the same capability as writing one.

      There is no separate `booking.read_internal_note`, and inventing one would put a permission
      in the role form that no built-in role carries. Both roles that work bookings — support and
      operations — already hold this, so the practical effect is that FINANCE, which holds
      `booking.read_all` for the money, does not see staff prose about a named customer it has no
      reason to read. Least privilege, and absent rather than redacted for the same reason the
      payment section is: a row of asterisks still says how many notes there are.
    */
    const canSeeNotes = (claims?.permissions ?? []).includes('booking.add_internal_note');

    return {
      reference: booking['reference'],
      status: booking['status'],
      stay: {
        checkIn: booking['check_in'],
        checkOut: booking['check_out'],
        nights: booking['nights'],
        adults: booking['guests_adults'],
        children: booking['guests_children'],
        infants: booking['guests_infants'],
      },
      customer: {
        reference: booking['customer_reference'],
        name: booking['customer_name'],
        email: booking['customer_email'],
        phone: booking['customer_phone'],
        isGuest: booking['customer_is_guest'],
      },
      partner: {
        reference: booking['partner_reference'],
        name: booking['partner_name'],
        phone: booking['partner_phone'],
      },
      /*
        Arabic first, in all three — the only reader of this endpoint is the Arabic-only staff
        console, and it was printing the English unit name and the city's URL SLUG ("damascus")
        next to Arabic labels (Bashar, 2026-08-05). The property name preferred `name_en` outright,
        so the same booking read one way in the الحجوزات registry — which has always coalesced
        Arabic first — and another on its own detail screen.

        `coalesce` on the two name pairs even though both columns are NOT NULL: the fallback costs
        nothing and is what every other admin service does, so a future nullable column cannot turn
        a name into a blank cell here.
      */
      property: {
        reference: booking['property_reference'],
        name: booking['property_name'],
        unit: booking['unit_name'],
        city: booking['city_name'],
      },
      money: {
        currencyCode: booking['currency_code'],
        baseAmount: booking['base_amount'],
        customerFeeAmount: booking['customer_fee_amount'],
        walletAmount: booking['wallet_amount'],
        totalAmount: booking['total_amount'],
        /**
         * Commission and payable are the PARTNER's side of the money. Visible to
         * staff here, and never in any partner-facing response.
         */
        partnerCommissionAmount: booking['partner_commission_amount'],
        partnerPayableAmount: booking['partner_payable_amount'],
        totalSyp: booking['total_syp'],
        fxRateToSyp: booking['fx_rate_to_syp'],
      },
      dates: {
        createdAt: booking['created_at'],
        paidAt: booking['paid_at'],
        confirmationDeadlineAt: booking['confirmation_deadline_at'],
        confirmedAt: booking['confirmed_at'],
        cancelledAt: booking['cancelled_at'],
      },
      cancellationReason: booking['cancellation_reason'],
      timeline: timeline.rows.map((row) => ({
        eventType: row.event_type,
        actorType: row.actor_type,
        actorEmail: row.actor_email,
        payload: row.payload,
        createdAt: row.created_at,
      })),
      /*
        What a STAFF actor may do to this booking from here, decided by the state machine that
        will enforce it rather than by a second list in the console.

        `allowedTransitions` has carried the docblock "for building a UI" since it was written and
        has never had a caller. The console cannot import it — it lives in this app — and a copy
        of the transition table over there would be a second source of truth for the one question
        where disagreeing means offering a control the API is about to refuse.

        This says only what the BOOKING allows. Whether this reader may do it is the console's
        half, from their own capabilities; both are re-checked by the endpoints themselves, so
        neither is a security boundary — they decide what is worth offering.
      */
      actions: {
        cancel: allowedTransitions(booking['status'] as BookingStatus, 'staff').includes(
          'cancelled',
        ),
        /*
          Not from the transition table, and the asymmetry is real: `capture-payment` calls
          `markPaid`, which asserts the move as SYSTEM rather than as staff — it is standing in
          for a gateway webhook, not exercising a staff authority. So the state that permits it is
          `pending_payment` and only that, which is what `markPaid` itself asserts.
        */
        capturePayment: booking['status'] === 'pending_payment',
      },
      /*
        How much there is to find on the three screens this booking links out to.

        The links go to the existing registries with this reference as their search term — no
        embedded messaging here (Bashar, 2026-08-25). The counts exist so a link says whether it
        leads anywhere: «المحادثات (٠)» is an answer, and a link that silently lands on an empty
        list is the one thing worse than no link.

        Three equality counts, each on its own index — `disputes_booking_idx`,
        `conversations_booking_idx`, `notifications_booking_idx`. Uncapped deliberately, unlike a
        registry total: these are bounded by ONE booking, not by the size of a table.
      */
      related: await this.related(bookingId),
      // Absent, not redacted, for a caller without PAYMENT_READ — see the class note.
      ...(canSeePayments ? { payments: await this.payments(bookingId) } : {}),
      // Absent for the same reason, and on its own capability — see `canSeeNotes`.
      ...(canSeeNotes ? { notes: await this.notes(bookingId) } : {}),
    };
  }

  /**
   * Every internal note on one booking, OLDEST first.
   *
   * Oldest first because the section is a history and reads downwards: what was learnt, then what
   * was learnt next. Newest-first would put the latest note above the one that explains it.
   *
   * No `LIMIT`. A booking accumulates notes during one support case and then stops — unlike a
   * registry, which grows for as long as the business does. If that assumption ever breaks it
   * breaks visibly, on a screen somebody is reading, rather than by silently hiding the newest
   * notes the way a capped ascending scan would.
   */
  private async notes(bookingId: string) {
    const rows = await this.db.execute<{
      note: string;
      author: string | null;
      created_at: string;
    }>(sql`
      SELECT n.note,
             ${actorName(sql`us.email`, sql`us.role`)} AS author,
             ${utc('n.created_at')} AS created_at
      FROM booking_internal_notes n
      LEFT JOIN users us ON us.id = n.author_user_id
      WHERE n.booking_id = ${bookingId}
      ORDER BY n.created_at ASC
    `);

    return rows.rows.map((row) => ({
      note: row.note,
      author: row.author,
      createdAt: row.created_at,
    }));
  }

  /** What else exists against this booking, for the cross-links — see the note at the call site. */
  private async related(bookingId: string) {
    const rows = await this.db.execute<{
      disputes: number;
      conversations: number;
      notifications: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM disputes      d WHERE d.booking_id = ${bookingId}) AS disputes,
        (SELECT count(*)::int FROM conversations c WHERE c.booking_id = ${bookingId}) AS conversations,
        (SELECT count(*)::int FROM notifications n WHERE n.booking_id = ${bookingId}) AS notifications
    `);

    const row = rows.rows[0];

    return {
      disputes: row?.disputes ?? 0,
      conversations: row?.conversations ?? 0,
      notifications: row?.notifications ?? 0,
    };
  }

  /**
   * Adds a note. Append-only — see `booking_internal_notes`.
   *
   * ## The note does not reach the audit log
   *
   * `booking.internal_note_added` records THAT one was written, by whom, against which booking.
   * The text is free prose about a named customer; `audit_log` is append-only by trigger with no
   * redaction path, so copying it there would put those sentences somewhere §14 cannot follow
   * them. The note itself lives in one table, which erasure can reach.
   */
  async addNote(
    reference: string,
    note: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<{ reference: string }> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM bookings WHERE reference = ${reference} AND deleted_at IS NULL
    `);

    const booking = rows.rows[0];

    if (!booking) throw notFound(ERROR.BOOKING_NOT_FOUND);

    /*
      One transaction, so a note that was written and an audit row that says so cannot disagree.
      The insert alone would leave a note nobody can attribute if the audit write failed.
    */
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO booking_internal_notes (booking_id, author_user_id, note)
        VALUES (${booking.id}, ${claims?.sub ?? null}, ${note})
      `);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'booking.internal_note_added',
          subjectType: 'booking',
          subjectId: booking.id,
        },
        tx as unknown as Database,
      );
    });

    return { reference };
  }

  /** Payments and refunds, for finance (§4). */
  private async payments(bookingId: string) {
    const rows = await this.db.execute<{
      reference: string;
      method: string;
      provider: string;
      amount: string;
      status: string;
      captured_at: string | null;
      created_at: string;
    }>(sql`
      SELECT reference, method::text AS method, provider, amount::text AS amount,
             status::text AS status,
             ${utc('captured_at')} AS captured_at, ${utc('created_at')} AS created_at
      FROM payments
      WHERE booking_id = ${bookingId} AND deleted_at IS NULL
      ORDER BY created_at DESC
    `);

    const refunds = await this.db.execute<{
      amount: string;
      wallet_amount: string;
      status: string;
      reason: string;
      created_at: string;
    }>(sql`
      SELECT amount::text AS amount, wallet_amount::text AS wallet_amount,
             status::text AS status, reason, ${utc('created_at')} AS created_at
      FROM refunds
      WHERE booking_id = ${bookingId} AND deleted_at IS NULL
      ORDER BY created_at DESC
    `);

    return {
      attempts: rows.rows.map((row) => ({
        reference: row.reference,
        method: row.method,
        provider: row.provider,
        amount: row.amount,
        status: row.status,
        capturedAt: row.captured_at,
        createdAt: row.created_at,
      })),
      refunds: refunds.rows.map((row) => ({
        amount: row.amount,
        walletAmount: row.wallet_amount,
        status: row.status,
        reason: row.reason,
        createdAt: row.created_at,
      })),
    };
  }
}
