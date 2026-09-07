import { NextResponse } from 'next/server';

import { ERROR, setFxRateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Recording a currency's rate to SYP.
 *
 * ## Why this route exists (Bashar, 2026-09-07)
 *
 * «I do not want operational workflows that require manual API calls. Please add a proper Super
 * Admin screen for FX rate management.»
 *
 * `GET`/`POST /admin/fx-rates` and the `FX_RATE_MANAGE` permission had existed with no caller in
 * any of the three applications — and المدن والدول والعملات told operators «تعديل أسعار الصرف من
 * شاشة أسعار الصرف», linking to a settings page that has no such section. So the console signposted
 * a screen that did not exist, and the only way to set a rate was an authenticated request by hand.
 *
 * The cost was not theoretical: EUR and TRY were ACTIVE currencies with no rate at all, so the
 * platform refused to price in them, and launch blocker 196 was recorded as «business decision, no
 * engineering left» when in fact there was nowhere to enter the decision.
 *
 * ## The shape is validated here as well as by the API
 *
 * `setFxRateSchema` refuses SYP (the pair completes with it), demands a decimal STRING rather than
 * a JSON number — SYP rates are five significant digits and a double would quietly round them —
 * and bounds the source to the three it audits. Checked before the round trip so a malformed rate
 * is answered without one; the API validates again on its own authority, because this is a
 * convenience and not the control.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = setFxRateSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy('/admin/fx-rates', { method: 'POST', body: parsed.data });
}
