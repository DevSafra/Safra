import { NextResponse } from 'next/server';

import { ERROR, partnerOnboardSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * تسجيل شريك جديد — creating a partner outright (Bashar, 2026-08-23).
 *
 * Validated against the shared schema here as well as at the API, for the reason the verify route
 * gives: the rules live in one place rather than being restated in the form, and the operator
 * learns about a malformed address before a round trip.
 *
 * The API remains the boundary. This cannot be the authorization check — `PARTNER_ONBOARD` is
 * decided there, against the token, on every request — and nothing here is trusted by it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = partnerOnboardSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      {
        /*
          The CODE, not Zod's English prose. The schema's messages are error codes
          (`docs/i18n.md`), so the console resolves them into Arabic; forwarding the raw message
          would print English under an Arabic label.
        */
        message: parsed.error.issues[0]?.message ?? ERROR.VALIDATION_REQUIRED,
        field: parsed.error.issues[0]?.path[0] ?? null,
      },
      { status: 400 },
    );
  }

  return proxy('/admin/partner-onboarding', { method: 'POST', body: parsed.data });
}
