/**
 * The console's status colours — re-exported from `@safra/ui`, which owns the vocabulary.
 *
 * ## Why this file still exists
 *
 * It briefly held `bookingStatusTone`, a booking-only map extracted because the الحجوزات table and
 * the booking detail had drifted apart (Bashar, 2026-08-05). The same drift then turned out to run
 * across the whole console — eleven tone functions and four hand-rolled pills, disagreeing about
 * what colour `expired` or `approved` is (Bashar, 2026-08-06). So the map moved up to `@safra/ui`,
 * where the customer app can read it too: bookings are painted in both apps, and a colour rule
 * that lives in one app is a colour rule that drifts.
 *
 * This module is kept as the console's import point so pages depend on `@/lib/status-tone` rather
 * than reaching into the package directly, and so a console-only exception — if one is ever truly
 * justified — has an obvious home that is not a switch statement inside a page.
 */
export { statusTone, type Tone } from '@safra/ui';
