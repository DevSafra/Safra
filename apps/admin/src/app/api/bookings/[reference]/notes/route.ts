import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Appends a staff note to a booking — `BOOKING_ADD_INTERNAL_NOTE`.
 *
 * A separate authority from reading the booking: §4 gives support and operations the note, and
 * finance reads the money without it. Notes are appended, never replaced, so nothing here can
 * amend what a colleague wrote earlier.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/admin/bookings/${encodeURIComponent(reference)}/notes`, {
    method: 'POST',
    body: await request.json(),
  });
}
