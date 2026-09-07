import { sql, type SQL } from 'drizzle-orm';

/**
 * A booking's accommodation, as the LINES a person reads.
 *
 * ## Why this is one fragment rather than seven queries
 *
 * A booking may hold several room types since 0070, and `bookings.unit_id` names only the first of
 * them. Seven surfaces render a booking's accommodation — the voucher, its QR, the confirmation
 * email, the invoice, the customer's own booking page, the partner's arrivals list and queue, and
 * the console's booking detail — and each of them printing that one column would name one type on
 * a booking that holds three.
 *
 * Seven separately written GROUP BYs would drift. This is the one, and it is a correlated subquery
 * so a caller adds it to a SELECT they already have rather than making a second round trip for it.
 *
 * ## What it returns
 *
 * A JSON array, ordered so the cheapest line comes last — the same order the property page offers
 * the types in, so a guest recognises their own basket. Each entry carries the type's name in all
 * three languages (the caller knows the reader's), how many rooms, and what those rooms cost.
 *
 * `unit_label` is deliberately ABSENT. Which physical doors a booking holds is partner-and-staff
 * information: a guest-held voucher naming a room number tells whoever finds it which room a named
 * person is sleeping in. The screens that need the doors ask for them separately.
 */
export function bookingLines(bookingId: SQL | string): SQL {
  return sql`(
    SELECT coalesce(
      jsonb_agg(line ORDER BY (line->>'amount')::numeric DESC),
      '[]'::jsonb
    )
    FROM (
      SELECT jsonb_build_object(
               'unitId',   min(u.id::text),
               'nameAr',   min(u.name_ar),
               'nameEn',   min(u.name_en),
               'nameDe',   min(u.name_de),
               'rooms',    count(*)::int,
               'amount',   coalesce(sum(bu.accommodation_amount), 0)::text
             ) AS line
      FROM booking_units bu
      JOIN units u ON u.id = bu.unit_id
      WHERE bu.booking_id = ${bookingId}
      /*
        Grouped by the room's IDENTITY, not by its id: rooms of one type are interchangeable and a
        guest chose the type, so «مزدوجة قياسية × 2» is one line rather than two rooms listed
        separately. The identity is the same triple the allocation and the property page use — type
        code, price, capacity — so all three agree about what «the same room» means.
      */
      GROUP BY coalesce(u.room_type_code, u.id::text), u.base_price, u.max_guests
    ) grouped
  )`;
}

/** One line as every surface reads it. */
export interface BookingLine {
  readonly unitId: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly nameDe: string | null;
  readonly rooms: number;
  readonly amount: string;
}

/**
 * The lines as one sentence, for a surface with no room to list them.
 *
 * «غرفة مزدوجة قياسية × 2 · جناح تنفيذي × 1». Used by the voucher's QR and the confirmation email,
 * where the alternative is naming the first type and leaving the rest to be discovered at
 * reception.
 */
export function describeLines(
  lines: readonly BookingLine[],
  name: (line: BookingLine) => string,
): string {
  return lines.map((line) => `${name(line)} × ${line.rooms}`).join(' · ');
}
