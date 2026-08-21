import 'server-only';

import { redirect } from 'next/navigation';

import { getMyProfile, type PartnerProfile } from '@/lib/api';

/**
 * Where an unverified partner is sent, and the one page they are not sent away from.
 *
 * A literal, never anything derived from a request: it is a redirect target, and one built from
 * the URL would be an open redirect on every page in the portal.
 */
export const ONBOARDING_PATH = '/contracts';

/**
 * Until SAFRA has verified a partner, العقود والمستندات is the whole portal (Bashar, 2026-08-21).
 *
 * ## Why the portal hides itself rather than merely refusing
 *
 * The API already refuses every write a partner may not make — prices, dates, images and, since
 * `O-sec-12`, the units that ride along on a property create. That is the security boundary and
 * this is not. What this fixes is a different problem: a partner whose account is an hour old was
 * shown لوحة التحكم with «—» in all four KPI cards, عقاراتي with no listings, التقويمات with
 * nothing to show and مستحقاتي with no payout — six screens that look broken because they are
 * empty, and one screen that says what to actually do, reachable only if they went looking.
 *
 * So the portal shows one thing until there is more than one thing to show. The wait is not
 * shorter; it is legible.
 *
 * ## It fails OPEN, on purpose
 *
 * A profile read that fails means the API is unreachable, not that the partner is unverified.
 * Bouncing them to العقود والمستندات — which is served by the same API and would be just as
 * broken — trades one unhelpful screen for another and loses the page's own «تعذّر التحميل»,
 * which at least names what happened. Nothing is protected by failing closed here, because
 * nothing is protected here at all: every route this guards is a READ of the partner's own data,
 * scoped by the API to the `partnerId` in their token.
 *
 * That is the whole reason this may fail open and `VerifiedPartnerGuard` may not.
 *
 * ## Kept honest by a test, not by memory
 *
 * A new page under `app/` that forgets this call is invisible — it works, and it works for the
 * wrong people. `gate-coverage.test.ts` reads the directory and fails on any page that neither
 * calls this nor appears in its exemption list with a reason.
 */
export async function requireVerifiedPartner(): Promise<
  PartnerProfile | 'failed' | 'unauthenticated'
> {
  const profile = await getMyProfile();

  if (profile === 'failed' || profile === 'unauthenticated') return profile;

  if (profile.verification !== 'approved') redirect(ONBOARDING_PATH);

  return profile;
}

/**
 * Whether the portal's navigation should be reduced to the onboarding page.
 *
 * Separate from the redirect because the two answers differ on ONE screen: العقود والمستندات
 * itself is reachable while unverified and must still show a locked sidebar, or the reader is
 * offered five links that bounce them straight back here.
 */
export function isLocked(
  profile: PartnerProfile | 'failed' | 'unauthenticated',
): boolean {
  if (profile === 'failed' || profile === 'unauthenticated') return false;

  return profile.verification !== 'approved';
}
