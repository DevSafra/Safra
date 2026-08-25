import 'server-only';

import { seeOther } from '@safra/session';

import { getStaffSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * «تصدير CSV» — asks the API for a file, then sends the operator to collect it.
 *
 * ## Why this became a POST that redirects
 *
 * It was a GET that streamed a CSV. BullMQ phase 5 moved the build to a worker, and two things
 * follow. A GET that CREATES a row would let a prefetch, a pasted link or a crawler produce an
 * export in somebody's name — and an export is the cheapest way to pull a large slice of customer
 * data out of the console, so that is not a theoretical objection. And a file that takes minutes to
 * build cannot be a response at all.
 *
 * So: POST, then `303` to the collection screen, which is an ordinary shareable GET. The
 * post/redirect/get shape is the same one the rows-per-page bar uses, for the same reason.
 *
 * The filters are forwarded verbatim rather than re-parsed. Re-validating would create a second
 * definition of a valid export, and the API's `.strict()` schema is the one that counts.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const session = await getStaffSession();

  /*
    A redirect, not a body. The operator pressed «تصدير CSV» on a form, so the browser navigates:
    `Not signed in.` rendered as a bare English document with no console around it. Sign-in is the
    honest destination, and the middleware sends them here anyway on the next page they open.
  */
  if (!session) return seeOther('/login');

  /* A malformed body means no filters, not an error page — the export is still valid. */
  const form = await request.formData().catch(() => new FormData());
  const body: Record<string, string> = {};

  for (const key of ['q', 'status'] as const) {
    const value = form.get(key);

    if (typeof value === 'string' && value) body[key] = value;
  }

  const response = await fetch(`${API_URL}/api/v1/admin/bookings/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  /*
    The operator lands on the collection screen either way.

    A failed request still has somewhere honest to send them — the list shows what exists, and if
    nothing new appeared they can ask again. An error page instead would lose the filters they had,
    which is the work the export was about.
  */
  const target = response.ok ? '/bookings/exports' : '/bookings/exports?failed=1';

  /* Relative, so the host the standalone server is bound to cannot become the redirect target. */
  return seeOther(target);
}
