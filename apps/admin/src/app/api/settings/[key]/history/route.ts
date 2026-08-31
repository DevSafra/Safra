import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * The change history of one operational setting (§9.3).
 *
 * ## Why this route did not exist until now
 *
 * `settings_history` has been written inside the same transaction as every setting change since
 * the schema was created, and `GET /admin/settings/:key/history` has existed on the API for as
 * long — with nothing calling it. The table's own reason for being is that a March booking's
 * snapshot says the fee was 1.99 and only the history says when that stopped being true, and that
 * question was answerable only in `psql`.
 *
 * A GET, and therefore no origin check: it reads, it writes nothing, and `proxy` attaches the
 * access token from the HttpOnly cookie server-side so no token reaches the browser. The API
 * enforces `SETTINGS_READ` — the same permission that let the reader see the value in the first
 * place, so this discloses nothing they could not already read on the row.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  const { key } = await params;

  return proxy(`/admin/settings/${encodeURIComponent(key)}/history`, {
    method: 'GET',
  });
}
