import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Recording a guest's arrival, and undoing it.
 *
 * ## Why the action is a path segment against an ALLOW-LIST
 *
 * One route rather than two because the pair are the same request in opposite directions and would
 * otherwise be two files differing by a word. What matters is that `action` never reaches the
 * upstream path unchecked: it comes from the URL, and an unvalidated segment interpolated into an
 * API path is how a caller reaches an endpoint nobody meant to expose. The allow-list means the
 * only two strings that can be forwarded are the two written here — `encodeURIComponent` would keep
 * a crafted value inside one segment but would still forward it.
 *
 * A body is never read. Both moves are decided entirely by the reference and the action; there is
 * nothing a caller could put in a body that should change either.
 *
 * ## Ownership and state are the API's to decide
 *
 * A second press, a cancelled booking, and another business's reference all answer 404 from the
 * API, which resolves the booking by reference INSIDE the caller's own partner and bounds the move
 * by status in the same `WHERE`. This route adds no second opinion about either.
 */
const ACTIONS = new Set(['check-in', 'undo-check-in']);

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string; action: string }> },
): Promise<NextResponse> {
  const { reference, action } = await params;

  if (!ACTIONS.has(action)) {
    return NextResponse.json({ code: ERROR.REQUEST_NOT_FOUND }, { status: 404 });
  }

  return proxy(`/partner/arrivals/${encodeURIComponent(reference)}/${action}`, {
    method: 'POST',
  });
}
