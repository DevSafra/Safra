import { proxy } from '@/lib/proxy';

/**
 * EC-010 tier 2, step one — send a code to the contact details ON this booking.
 *
 * No body. The destination is read from the booking by the API, never taken from the request:
 * accepting an address here would let a caller name their own and receive a code for a stranger's
 * stay, which is the attack the whole flow is built against.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/bookings/${encodeURIComponent(reference)}/verification`, {
    method: 'POST',
  });
}
