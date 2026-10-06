import { inArray, sql } from 'drizzle-orm';

import { schema, type Database } from '@safra/db';

/**
 * Gives a coupon back when the booking that spent it is never paid (Bashar, 2026-10-06: «Give it
 * back»).
 *
 * ## Why a redemption is written at creation and undone here
 *
 * The redemption is taken inside the booking's own transaction, under the coupon's row lock,
 * because that is the only place `max_redemptions` can be held: two customers spending the last
 * one of a hundred must not both get it. But a booking that is abandoned at the payment screen,
 * cancelled before paying, or expired by EC-001 never bought anything, and a coupon counts as used
 * only once the booking is PAID. So every path that takes a booking out of `pending_payment`
 * without paying calls this, in the same transaction as that status change.
 *
 * ## Once, by construction
 *
 * The redemption row is DELETED and the counter is decremented by exactly the rows that delete
 * returned, in one statement. A second call for the same booking deletes nothing and so subtracts
 * nothing; there is no flag to forget and no read-then-write to race. The caller's status UPDATE
 * is guarded on `pending_payment`, so only the writer that actually moved the booking reaches here.
 *
 * Takes the booking ids rather than one id because the expiry sweep cancels a batch in one
 * statement and releases them in the same transaction.
 */
export async function releaseCouponRedemptions(
  tx: Database,
  bookingIds: readonly string[],
): Promise<number> {
  if (bookingIds.length === 0) return 0;

  /*
    `inArray`, not `= ANY(${'${list}'})`: a JS array in a `sql` template expands to a tuple, which
    is a documented trap here and has cost a silent no-op before.
  */
  const released = await tx.execute<{ n: string }>(sql`
    WITH gone AS (
      DELETE FROM coupon_redemptions
      WHERE ${inArray(schema.couponRedemptions.bookingId, [...bookingIds])}
      RETURNING coupon_id
    ), per_coupon AS (
      SELECT coupon_id, count(*)::int AS n FROM gone GROUP BY coupon_id
    ), counted AS (
      UPDATE coupons c
      SET redemptions_count = c.redemptions_count - per_coupon.n, updated_at = now()
      FROM per_coupon
      WHERE c.id = per_coupon.coupon_id
      RETURNING c.id
    )
    SELECT count(*)::text AS n FROM gone
  `);

  return Number(released.rows[0]?.n ?? 0);
}
