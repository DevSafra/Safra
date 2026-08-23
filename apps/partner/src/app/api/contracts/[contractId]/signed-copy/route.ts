import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { getPartnerSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * The partner's hand-signed copy, on its way back to SAFRA (Bashar, 2026-08-21).
 *
 * Electronic signatures are not accepted in Syria, so the partner downloads the contract, signs it
 * by hand, scans it and uploads it here. The API makes the contract binding and emails the super
 * admins.
 *
 * ## Base64 in JSON, not multipart
 *
 * Matching how the API takes the staff-side upload: one schema covers the whole request and there
 * is no multipart parser in this app's dependency tree to keep patched. The size ceiling is the
 * API's, enforced by its schema, by a byte-length check and by a database CHECK — this route
 * forwards and does not re-implement any of them.
 *
 * ## The contract id is the only thing a caller names
 *
 * No partner id, because the API derives it from the token this route attaches. "Return a signed
 * copy of somebody else's contract" is not a request that can be made, rather than one that is
 * refused.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ contractId: string }> },
): Promise<NextResponse> {
  const session = await getPartnerSession();

  if (!session) {
    return NextResponse.json({ code: ERROR.AUTH_REQUIRED }, { status: 401 });
  }

  const { contractId } = await params;
  const body: unknown = await request.json().catch(() => null);

  const response = await fetch(
    `${API_URL}/api/v1/partner/contracts/${encodeURIComponent(contractId)}/signed-copy`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  );

  /* The API's own answer, code and all — this route adds no opinion of its own. */
  return NextResponse.json(await response.json().catch(() => ({})), {
    status: response.status,
  });
}
