import { proxy } from '@/lib/proxy';

/**
 * Undoes an arrival — bounded to `checked_in`, so it cannot reach into a completed or disputed stay.
 *
 * Checking in the wrong room is the most ordinary mistake the screen produces; without an undo the
 * only route back is a support ticket, and recording an arrival becomes something people hesitate
 * over. That defeats the screen.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/bookings/${encodeURIComponent(reference)}/undo-check-in`, {
    method: 'POST',
  });
}
