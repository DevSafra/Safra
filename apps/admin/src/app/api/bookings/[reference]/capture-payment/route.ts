import { proxy } from '@/lib/proxy';

/**
 * Marks payment captured and starts the partner's clock (§6.3 step 5) — `BOOKING_UPDATE_STATUS`.
 *
 * A stand-in for the payment webhook, which does not exist until a gateway is chosen (ADR 0002).
 * It is staff-gated and kept separate from `markPaid` for that reason: when a real webhook arrives
 * it calls `markPaid` directly and this stays a testing affordance rather than becoming a way to
 * mark bookings paid without money.
 *
 * No body is forwarded. The booking IS the whole instruction — every figure comes from its own
 * snapshotted columns — and an amount taken from the request would be an amount somebody could
 * choose.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/bookings/${encodeURIComponent(reference)}/capture-payment`, {
    method: 'POST',
  });
}
