import { sql } from 'drizzle-orm';

/**
 * Where a delivery-log row lives, for a city-scoped reader.
 *
 * ## One fragment for every read of the log
 *
 * The list, its counters and the re-drive each wrote their own joins, and each wrote
 * `coalesce(b.city_id, p.city_id)`. A notice about a DISPUTE carries `dispute_id` and neither of
 * the other two, so its city came out NULL, which `scopeFilter` reads as a platform-level row: a
 * member scoped to Damascus read every dispute notice in the country, and could re-drive one. The
 * counters had no scope at all. Stating it once is what keeps the three answering one question.
 *
 * `n` is the `notifications` alias every caller uses. `CITY` is a literal handed to `scopeFilter`,
 * which interpolates it raw, so it must never be built from input.
 */
export const NOTIFICATION_SUBJECT_JOINS = sql`
  LEFT JOIN bookings b  ON b.id = n.booking_id
  LEFT JOIN disputes d  ON d.id = n.dispute_id
  LEFT JOIN bookings db ON db.id = d.booking_id
  LEFT JOIN partners p  ON p.id = n.partner_id`;

export const NOTIFICATION_CITY = 'coalesce(b.city_id, db.city_id, p.city_id)';
