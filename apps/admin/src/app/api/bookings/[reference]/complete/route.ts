import { proxy } from '@/lib/proxy';

/**
 * Ends a stay by hand — `BOOKING_UPDATE_STATUS`.
 *
 * The EXCEPTION. `stay-completion` sweeps every departed stay hourly and is the ordinary path;
 * this is for the one whose dates say it is still running and whose guest has demonstrably gone.
 *
 * It matters more than it looks: `completed` is the predicate `PayoutService` accrues over and
 * `ReviewService` requires, and nothing wrote it at all before 2026-08-25.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/bookings/${encodeURIComponent(reference)}/complete`, { method: 'POST' });
}
