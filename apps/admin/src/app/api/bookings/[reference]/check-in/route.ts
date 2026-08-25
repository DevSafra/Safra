import { proxy } from '@/lib/proxy';

/**
 * Staff record an arrival — `BOOKING_CHECK_IN`, the same capability the partner's front desk holds.
 *
 * The ordinary path is the partner's own أوصلوا اليوم screen. This is for the partner who cannot
 * reach it, and differs only in having no `partner_id` in its predicate. No body: the booking is
 * the whole instruction.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/bookings/${encodeURIComponent(reference)}/check-in`, { method: 'POST' });
}
