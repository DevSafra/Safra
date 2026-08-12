import { NextResponse } from 'next/server';

import { ERROR, supportOpenSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Opening a support request (الدعم).
 *
 * The same endpoint the customer app calls. Which threads a caller can see is decided by the API from the
 * verified token — a partner carries `partnerId` — so there is nothing here that names the partner and
 * nothing to tamper with.
 *
 * Validated against the shared schema before the round trip, as this app's other writes are, so the
 * ten-character floor lives in one place rather than being restated in the form.
 *
 * Nothing is logged. The API redacts contact details out of the body precisely so they are not stored;
 * writing the raw body to a proxy log would put back exactly what the redaction removed.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = supportOpenSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy('/support', { method: 'POST', body: parsed.data });
}
