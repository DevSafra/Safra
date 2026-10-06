import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';

import type { EmergencyFlags } from './emergency.service.js';

/**
 * The three levers of Emergency Mode that change what the platform DOES (EC-009).
 *
 * `broadcast` is the fourth and is not here: it tells people something, it enforces nothing.
 */
export type EnforcedEmergencyFlag = Exclude<keyof EmergencyFlags, 'broadcast'>;

/**
 * «Is this property inside an active declaration that pulls `flag`?», as a SQL predicate.
 *
 * ## Why the flags were stored and never read
 *
 * `EmergencyService` wrote `stopBookings`, `waiveFines` and `suspendSla` from 2026-08-04, and the
 * console showed them as armed, while booking creation and the SLA sweep had no idea the table
 * existed. A Super Admin who stopped bookings in a city during a storm was shown a banner saying so
 * while customers went on paying for stays there. A switch that reports itself on and changes
 * nothing is worse than no switch: it is the one thing an operator will not double-check.
 *
 * ## Scope
 *
 * A declaration names a CITY or a COUNTRY (`emergency_modes.scope`). A property is covered by one
 * on its own city, and by one on the country that city belongs to — a national outage covers every
 * city in it without anybody having to list them.
 *
 * ## Shape
 *
 * A predicate rather than a lookup, so the SLA sweep filters its batch in the same statement it
 * reads it with (no N+1, and the 100-row LIMIT applies to bookings the sweep may act on). The table
 * is tiny by nature, an incident is rare, and `emergency_modes_active_idx` covers the lookup, so the
 * EXISTS costs an index probe per candidate row.
 *
 * `@>` against a parameter, never a key spliced into SQL text. A row written before a flag existed
 * lacks the key, and `@>` reads that as off, which is the safe answer for every lever: a missing
 * key never stops commerce nor waives a fine by accident.
 */
export function emergencyCovers(flag: EnforcedEmergencyFlag, propertyId: SQL): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM emergency_modes em
    JOIN properties emp ON emp.id = ${propertyId}
    JOIN cities emc     ON emc.id = emp.city_id
    WHERE em.deactivated_at IS NULL
      AND em.deleted_at IS NULL
      AND em.flags @> ${JSON.stringify({ [flag]: true })}::jsonb
      AND (
        (em.scope = 'city' AND em.scope_id = emc.id)
        OR (em.scope = 'country' AND em.scope_id = emc.country_id)
      )
  )`;
}

/**
 * Whether an active declaration has stopped new bookings for this property.
 *
 * Read per booking draft rather than cached. It is one index probe on a table with a handful of
 * rows, and a cache would be the one place an activation could lag: «stop» has to mean the next
 * booking, on every replica, not the next booking after a TTL.
 */
export async function emergencyStopsBookings(
  db: Database,
  propertyId: string,
): Promise<boolean> {
  const rows = await db.execute<{ stopped: boolean }>(sql`
    SELECT ${emergencyCovers('stopBookings', sql`${propertyId}::uuid`)} AS stopped
  `);

  return rows.rows[0]?.stopped === true;
}
