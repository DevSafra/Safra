import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * The four things a super admin can do to a partnership request.
 *
 * A thin proxy. The API owns the validation, the permission check, the account resolution and the
 * audit entry; re-validating here would create a second definition of a valid acceptance and the
 * two would drift.
 *
 * ## The action is an ALLOW-LIST, not a path segment
 *
 * `[action]` arrives from the URL, and it is used to build the upstream path. Passed through, a
 * request to `/api/partner-applications/PRQ-1/..%2f..%2fstaff` would reach an endpoint nobody
 * meant to expose. Checked against four literals, the worst a crafted value achieves is a 404.
 */
const ACTIONS: Readonly<Record<string, string>> = {
  contact: 'contact',
  accept: 'accept',
  reject: 'reject',
  resend: 'resend-invitation',
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string; action: string }> },
): Promise<NextResponse> {
  const { reference, action } = await params;
  const upstream = ACTIONS[action];

  if (!upstream) {
    return NextResponse.json({ message: 'Unknown action.' }, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => null);

  return proxy(
    `/admin/partner-applications/${encodeURIComponent(reference)}/${upstream}`,
    { method: 'POST', body: body ?? {} },
  );
}
