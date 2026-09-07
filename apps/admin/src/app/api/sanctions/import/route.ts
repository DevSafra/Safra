import { NextResponse } from 'next/server';

import { ERROR, sanctionsImportSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Replacing the sanctions list by hand.
 *
 * ## Why this route exists (Bashar, 2026-09-07)
 *
 * «Please add the missing administrative surface for manual refresh/import so the platform is not
 * blocked solely by configuration.»
 *
 * The endpoint had existed as the documented fallback for exactly this situation and had no caller
 * in any application. Measured the same day: the only sanctions snapshot was 17 days old against a
 * 7-day limit, so `SanctionsService.screen` was refusing and every partner verification was
 * blocked — correctly, because screening against a list you cannot prove is current looks like
 * compliance and provides none. `SANCTIONS_FEED_URL` was unset, so the daily refresh had never
 * run. Two of the three ways out were unbuilt and the third unconfigured.
 *
 * ## The body is the export itself
 *
 * `sanctionsImportSchema` takes the EU consolidated list as XML with a 1,000-character floor —
 * a truncated download is a shorter list, and a shorter list is a partner who screens clean
 * because the entry naming them did not arrive. Checked here so a wrong file is refused before
 * the round trip; the API parses and validates on its own authority.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = sanctionsImportSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy('/admin/sanctions/import', { method: 'POST', body: parsed.data });
}
