import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { conflict, notFound } from '../common/errors/app-error.js';

/** One coupon as its offered partner sees it. */
export interface PartnerCouponRow {
  readonly code: string;
  readonly status: 'pending' | 'accepted' | 'rejected';
  readonly valueKind: string;
  readonly value: string;
  readonly currencyCode: string | null;
  readonly maxDiscountAmount: string | null;
  readonly minBookingAmount: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly expired: boolean;
  /** How many times this partner's own bookings have used it — nobody else's. */
  readonly redemptions: number;
  readonly decidedAt: string | null;
}

/**
 * A partner's own coupons — offered, taken up, or refused (Bashar, 2026-09-01).
 *
 * ## Why a partner decides at all
 *
 * A discount comes off what the customer pays and the partner is still owed what the stay is
 * worth, but a coupon changes the price a listing is advertised at, and that is the partner's
 * business decision. So a new coupon is OFFERED to every eligible partner and only an acceptance
 * makes their bookings eligible — `CouponService.judge` refuses the rest.
 *
 * ## Accepting is final, and the refusal says so
 *
 * There is no route from `accepted` to anything else. A customer may already have booked against
 * the discount, so withdrawing would either break that booking's price or leave a discount nobody
 * agreed to still being honoured. The portal warns before confirming; this refuses afterwards, so
 * the rule holds for somebody posting to the endpoint directly.
 */
@Injectable()
export class PartnerCouponsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every coupon this partner has been offered, newest first.
   *
   * Not paginated: a partner is offered a handful of coupons a year, and the three sections the
   * portal draws are this one list grouped by status. If that ever stops being true it needs the
   * same keyset treatment as every other list — noted here so the next person does not have to
   * rediscover why it differs.
   */
  async list(partnerId: string): Promise<PartnerCouponRow[]> {
    const rows = await this.db.execute<{
      code: string;
      status: PartnerCouponRow['status'];
      value_kind: string;
      value: string;
      currency_code: string | null;
      max_discount_amount: string | null;
      min_booking_amount: string | null;
      starts_at: string;
      ends_at: string;
      expired: boolean;
      redemptions: number;
      decided_at: string | null;
    }>(sql`
      SELECT c.code, cp.status::text AS status,
             c.value_kind::text AS value_kind, c.value::text AS value,
             cur.code AS currency_code,
             c.max_discount_amount::text AS max_discount_amount,
             c.min_booking_amount::text  AS min_booking_amount,
             c.starts_at::text AS starts_at, c.ends_at::text AS ends_at,
             (c.ends_at <= now()) AS expired,
             -- THIS partner's bookings only. A count over every redemption would tell one
             -- partner how a campaign is performing at another's listings.
             (SELECT count(*)::int FROM coupon_redemptions r
              JOIN bookings b ON b.id = r.booking_id
              JOIN properties pr ON pr.id = b.property_id
              WHERE r.coupon_id = c.id AND pr.partner_id = cp.partner_id) AS redemptions,
             cp.decided_at::text AS decided_at
      FROM coupon_partners cp
      JOIN coupons c ON c.id = cp.coupon_id
      LEFT JOIN currencies cur ON cur.id = c.currency_id
      WHERE cp.partner_id = ${partnerId}::uuid
        AND cp.deleted_at IS NULL AND c.deleted_at IS NULL
      ORDER BY cp.status = 'pending' DESC, c.ends_at DESC
    `);

    return rows.rows.map((row) => ({
      code: row.code,
      status: row.status,
      valueKind: row.value_kind,
      value: row.value,
      currencyCode: row.currency_code,
      maxDiscountAmount: row.max_discount_amount,
      minBookingAmount: row.min_booking_amount,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      expired: row.expired,
      redemptions: row.redemptions,
      decidedAt: row.decided_at,
    }));
  }

  /**
   * Records the partner's decision, once.
   *
   * ## The guard is the WHERE, not a read followed by a write
   *
   * `status = 'pending'` is in the update itself, so two presses of «قبول» — or a press racing a
   * replayed request — cannot both succeed. The second matches no row and is refused, which is the
   * same answer somebody gets for trying to reverse a decision that was already made.
   */
  async decide(
    claims: AccessTokenClaims | undefined,
    partnerId: string,
    code: string,
    decision: 'accepted' | 'rejected',
  ): Promise<{ code: string; status: string }> {
    const found = await this.db.execute<{ coupon_id: string; status: string }>(sql`
      SELECT cp.coupon_id::text, cp.status::text AS status
      FROM coupon_partners cp
      JOIN coupons c ON c.id = cp.coupon_id
      WHERE cp.partner_id = ${partnerId}::uuid AND upper(c.code) = upper(${code})
        AND cp.deleted_at IS NULL AND c.deleted_at IS NULL
      LIMIT 1
    `);

    const offer = found.rows[0];

    if (!offer) throw notFound(ERROR.COUPON_NOT_FOUND);
    if (offer.status !== 'pending') throw conflict(ERROR.COUPON_ALREADY_DECIDED);

    await this.db.transaction(async (tx) => {
      const done = await tx.execute<{ partner_id: string }>(sql`
        UPDATE coupon_partners
        SET status = ${decision}::coupon_partner_status,
            decided_at = now(),
            decided_by_user_id = ${claims?.sub ?? null},
            updated_at = now()
        WHERE coupon_id = ${offer.coupon_id}::uuid
          AND partner_id = ${partnerId}::uuid
          AND status = 'pending'
        RETURNING partner_id::text
      `);

      if (done.rows.length === 0) throw conflict(ERROR.COUPON_ALREADY_DECIDED);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action:
            decision === 'accepted'
              ? 'coupon.partner_accepted'
              : 'coupon.partner_rejected',
          subjectType: 'coupon',
          subjectId: offer.coupon_id,
          before: { code, status: 'pending' },
          after: { code, status: decision },
        },
        tx as unknown as Database,
      );
    });

    return { code, status: decision };
  }
}
