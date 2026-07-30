import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { canTransition, type Actor, type BookingStatus } from './booking-state.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * State transitions on an existing booking (§6.3 steps 5–8, §6.4).
 *
 * Every change goes through `transition()`, which consults the state machine before
 * touching a row. A guard in one place beats the same `if` repeated per endpoint,
 * and it means an illegal move returns 409 rather than silently corrupting a
 * booking's history.
 */
@Injectable()
export class BookingActionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Marks payment captured and starts the partner's clock (§6.3 step 5).
   *
   * Called by the payment webhook once a gateway is integrated. Exposed as a service
   * method now so the booking lifecycle is complete and testable without one.
   */
  async markPaid(reference: string, claims: AccessTokenClaims | undefined) {
    const booking = await this.load(reference);

    this.assertTransition(booking.status, 'pending_confirmation', 'system');

    const windowMinutes = await this.settings.getNumber(
      'booking.confirmation_window_minutes',
      120,
    );

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE bookings
        SET status = 'pending_confirmation',
            paid_at = now(),
            -- The deadline is reset here: until now it held the payment window
            -- (EC-001), and from now it holds the partner's window (§6.4).
            confirmation_deadline_at = now() + (${windowMinutes}::int * INTERVAL '1 minute')
        WHERE id = ${booking.id} AND status = 'pending_payment'
      `);

      await tx.execute(sql`
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type)
        VALUES ('booking', ${booking.id}, 'booking.payment_captured', 'system')
      `);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'booking.payment_captured',
          subjectType: 'booking',
          subjectId: booking.id,
          before: { status: booking.status },
          after: {
            status: 'pending_confirmation',
            confirmationWindowMinutes: windowMinutes,
          },
        },
        tx as unknown as Database,
      );

      return { reference, status: 'pending_confirmation' as const };
    });
  }

  /**
   * The partner answering within the window (§6.4).
   *
   * A confirmation moves straight to `confirmed`: §6.3 step 7 has SAFRA confirm to
   * the customer as soon as the partner approves, so there is no intermediate state
   * for a booking to get stuck in.
   */
  async partnerDecision(
    reference: string,
    partnerId: string,
    decision: 'confirm' | 'reject',
    reason: string | undefined,
    claims: AccessTokenClaims | undefined,
  ) {
    const booking = await this.load(reference);

    // Ownership is part of the check, and a mismatch is 404 rather than 403 so a
    // partner cannot probe other partners' references.
    if (booking.partner_id !== partnerId) {
      throw new NotFoundException('Booking not found.');
    }

    const target: BookingStatus = decision === 'confirm' ? 'confirmed' : 'cancelled';
    this.assertTransition(booking.status, target, 'partner');

    return this.db.transaction(async (tx) => {
      if (decision === 'confirm') {
        await tx.execute(sql`
          UPDATE bookings
          SET status = 'confirmed',
              partner_responded_at = now(),
              confirmed_at = now(),
              confirmed_by_user_id = ${claims?.sub ?? null},
              confirmation_deadline_at = NULL
          WHERE id = ${booking.id} AND status = 'pending_confirmation'
        `);

        /**
         * Answering promptly is rewarded, because §5.5 ranks on response speed.
         * A simple running average: enough to move the ranking, and replaced by a
         * proper rolling window when the reporting module lands.
         */
        await tx.execute(sql`
          UPDATE partners
          SET avg_response_minutes = COALESCE(
                (avg_response_minutes + GREATEST(1, EXTRACT(EPOCH FROM (now() - b.paid_at)) / 60)) / 2,
                GREATEST(1, EXTRACT(EPOCH FROM (now() - b.paid_at)) / 60)
              )::int
          FROM bookings b
          WHERE partners.id = ${partnerId} AND b.id = ${booking.id} AND b.paid_at IS NOT NULL
        `);
      } else {
        await tx.execute(sql`
          UPDATE bookings
          SET status = 'cancelled',
              partner_responded_at = now(),
              cancelled_at = now(),
              cancellation_reason = ${reason ?? 'Rejected by partner.'}
          WHERE id = ${booking.id} AND status = 'pending_confirmation'
        `);

        /**
         * §6.4 treats a rejection AFTER payment as a violation too — the customer
         * paid on the strength of availability the partner advertised. The fine is
         * lighter than for silence, because at least they answered.
         */
        const priorRows = await tx.execute<{ count: string }>(sql`
          SELECT COUNT(*)::text AS count FROM partner_violations
          WHERE partner_id = ${partnerId} AND kind = 'rejected_after_payment'
        `);

        await tx.execute(sql`
          INSERT INTO partner_violations
            (partner_id, booking_id, kind, occurrence_number, score_penalty)
          VALUES (${partnerId}, ${booking.id}, 'rejected_after_payment',
                  ${Number(priorRows.rows[0]?.count ?? 0) + 1}, 2)
        `);

        await tx.execute(sql`
          UPDATE partners SET score = GREATEST(0, score - 2) WHERE id = ${partnerId}
        `);
      }

      await tx.execute(sql`
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type, actor_user_id, payload)
        VALUES ('booking', ${booking.id},
                ${decision === 'confirm' ? 'booking.confirmed' : 'booking.rejected_by_partner'},
                'partner', ${claims?.sub ?? null},
                ${JSON.stringify({ reason: reason ?? null })}::jsonb)
      `);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: decision === 'confirm' ? 'booking.confirmed' : 'booking.rejected',
          subjectType: 'booking',
          subjectId: booking.id,
          before: { status: booking.status },
          after: { status: target },
          reason: reason ?? null,
        },
        tx as unknown as Database,
      );

      return { reference, status: target };
    });
  }

  /** Customer or staff cancellation of a live booking. */
  async cancel(
    reference: string,
    reason: string,
    actor: Actor,
    claims: AccessTokenClaims | undefined,
  ) {
    const booking = await this.load(reference);
    this.assertTransition(booking.status, 'cancelled', actor);

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE bookings
        SET status = 'cancelled',
            cancelled_at = now(),
            cancelled_by_user_id = ${claims?.sub ?? null},
            cancellation_reason = ${reason}
        WHERE id = ${booking.id}
      `);

      await tx.execute(sql`
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type, actor_user_id, payload)
        VALUES ('booking', ${booking.id}, 'booking.cancelled', ${actor},
                ${claims?.sub ?? null}, ${JSON.stringify({ reason })}::jsonb)
      `);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'booking.cancelled',
          subjectType: 'booking',
          subjectId: booking.id,
          before: { status: booking.status },
          after: { status: 'cancelled' },
          reason,
        },
        tx as unknown as Database,
      );

      // Refund arithmetic against the snapshotted policy lands with the payment
      // module — there is no captured payment to refund until a gateway exists.
      return { reference, status: 'cancelled' as const, refundPending: true };
    });
  }

  private async load(reference: string) {
    const rows = await this.db.execute<{
      id: string;
      status: BookingStatus;
      partner_id: string;
    }>(sql`
      SELECT id, status::text AS status, partner_id
      FROM bookings
      WHERE reference = ${reference} AND deleted_at IS NULL
      LIMIT 1
    `);

    const booking = rows.rows[0];
    if (!booking) throw new NotFoundException('Booking not found.');

    return booking;
  }

  private assertTransition(from: BookingStatus, to: BookingStatus, actor: Actor): void {
    if (!canTransition(from, to, actor)) {
      throw new ConflictException(
        `A booking cannot move from ${from} to ${to}${actor === 'system' ? '' : ` as ${actor}`}.`,
      );
    }
  }
}
