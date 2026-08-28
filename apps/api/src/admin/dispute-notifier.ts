import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  disputePayoutReleasedMail,
  disputeRejectedMail,
  disputeResolvedMail,
} from '../mail/mail.templates.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Telling the two people a closed dispute is about.
 *
 * ## The gap this closes
 *
 * `DisputeService.close` released the partner's frozen payout, could credit the customer's wallet,
 * and notified NOBODY. Both of them found out by looking — a customer by opening the app on the off
 * chance, a partner by noticing money had moved. Reported in the النزاعات review of 2026-08-27 and
 * closed on Bashar's instruction the next day.
 *
 * ## Two messages, because two people need two different facts
 *
 * The CUSTOMER is told the decision and the sentence it was decided in. The PARTNER is told the
 * hold on their money is lifted and that nothing was cancelled by the dispute existing — and is
 * deliberately NOT told the resolution. The outcome is between SAFRA and the customer, and
 * forwarding a complaint's verdict to the party complained about would put a customer's words in
 * front of them without their asking.
 *
 * ## Nothing here can fail the closure
 *
 * `close()` has already committed by the time this runs, and every path below swallows its own
 * error. A dispute that was settled correctly must not appear to have failed because a mail server
 * was down — and the audit row records what actually happened, including nothing happening, which
 * is the case somebody investigating most needs to find.
 */
@Injectable()
export class DisputeNotifier {
  private readonly logger = new Logger(DisputeNotifier.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Announces a closure to the customer and to the partner.
   *
   * `outcome` decides only WHICH message the customer gets; the partner's is the same either way,
   * because what changed for them is the same either way.
   */
  async closed(
    actor: AccessTokenClaims | undefined,
    disputeId: string,
    outcome: 'resolved' | 'rejected',
  ): Promise<void> {
    /*
      Two outcomes, not three. «Nobody to write to» was a third, and it was unreachable:
      `customer_profiles.email` is NOT NULL and a dispute's profile and partner are both required
      by foreign keys, so an address is always there. A branch a fixture cannot reach is a branch
      no test protects, and this codebase has been bitten by exactly that.
    */
    let customer: 'queued' | 'failed' = 'failed';
    let partner: 'queued' | 'failed' = 'failed';

    try {
      const found = await this.db.execute<{
        reference: string;
        resolution: string | null;
        closed_at: string;
        booking_reference: string | null;
        customer_email: string | null;
        customer_locale: string | null;
        customer_profile_id: string;
        partner_email: string | null;
        partner_locale: string | null;
        partner_id: string;
      }>(sql`
        SELECT d.reference, d.resolution, d.customer_profile_id, d.partner_id,
               to_char(d.closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS closed_at,
               b.reference       AS booking_reference,
               c.email           AS customer_email,
               coalesce(cu.preferred_locale, 'ar') AS customer_locale,
               pu.email          AS partner_email,
               coalesce(pu.preferred_locale, 'ar') AS partner_locale
        FROM disputes d
        LEFT JOIN bookings b          ON b.id = d.booking_id
        LEFT JOIN customer_profiles c ON c.id = d.customer_profile_id
        LEFT JOIN users cu            ON cu.id = c.user_id
        LEFT JOIN partners p          ON p.id = d.partner_id
        LEFT JOIN users pu            ON pu.id = p.user_id
        WHERE d.id = ${disputeId}::uuid
        LIMIT 1
      `);

      const row = found.rows[0];

      if (!row) {
        this.logger.error(`Dispute ${disputeId} vanished before it could be announced.`);

        return;
      }

      const booking = row.booking_reference ?? '—';

      /* ── the customer ──────────────────────────────────────────────────── */
      {
        /*
          The template key is written out at each call rather than chosen into a variable.

          `notification-catalogue.test.ts` reads the source for `notify('key',` and fails any
          catalogue entry claiming to be implemented that it cannot find. That sweep exists because
          سجل القوالب once listed messages nothing sent, and a key assembled at runtime is invisible
          to it — the branch would be real and the catalogue would still be lying by its own
          standard. Two calls is the price of staying checkable.
        */
        const common = {
          to: row.customer_email ?? '',
          locale: row.customer_locale ?? 'ar',
          booking,
          reference: row.reference,
          /* The sentence a staff member wrote knowing it would be read — quoted, not summarised. */
          resolution: row.resolution ?? '',
          date: row.closed_at,
          url: `${this.env.APP_URL}/${row.customer_locale ?? 'ar'}/account/bookings/${booking}`,
        };
        const subject = { disputeId, customerProfileId: row.customer_profile_id };
        const locale = row.customer_locale ?? 'ar';

        try {
          if (outcome === 'resolved') {
            await this.notifications.notify(
              'dispute.resolved',
              disputeResolvedMail(common),
              locale,
              subject,
            );
          } else {
            await this.notifications.notify(
              'dispute.rejected',
              disputeRejectedMail(common),
              locale,
              subject,
            );
          }

          customer = 'queued';
        } catch (error) {
          this.logger.error(
            `Could not tell the customer that dispute ${row.reference} was ${outcome}.`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }

      /* ── the partner ───────────────────────────────────────────────────── */
      {
        try {
          await this.notifications.notify(
            'dispute.payout_released',
            disputePayoutReleasedMail({
              to: row.partner_email ?? '',
              locale: row.partner_locale ?? 'ar',
              booking,
              reference: row.reference,
              date: row.closed_at,
              url: `${this.env.PARTNER_URL}/bookings`,
            }),
            row.partner_locale ?? 'ar',
            { disputeId, partnerId: row.partner_id },
          );
          partner = 'queued';
        } catch (error) {
          this.logger.error(
            `Could not tell partner ${row.partner_id} that dispute ${row.reference} closed.`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Could not announce the closure of dispute ${disputeId}.`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    /*
      Audited whatever happened, including nothing happening.

      «The customer was never told» is the fact a complaint about a complaint turns on, and an audit
      written only on success cannot show it.
    */
    try {
      await this.audit.record({
        actorUserId: actor?.sub,
        actorRole: actor?.role,
        action: 'dispute.notified',
        subjectType: 'dispute',
        subjectId: disputeId,
        after: { outcome, customer, partner },
      });
    } catch (error) {
      this.logger.error(
        `Could not record that dispute ${disputeId} was announced.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
