import 'server-only';

import { redirect } from 'next/navigation';

import { getMyProfile, type PartnerProfile } from '@/lib/api';
import { getPartnerSession } from '@/lib/session-server';
import {
  PARTNER_EMPLOYEE_PERMISSIONS,
  PARTNER_SECTION_PERMISSIONS,
  canOpenSection,
  openableSections,
  type PartnerSection,
} from '@safra/contracts';
import { sessionPermissions } from '@safra/session';

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

/**
 * Whether the signed-in reader is a partner's EMPLOYEE rather than the account owner.
 *
 * ## Why a screen needs to ask
 *
 * The portal admits two roles since 2026-08-23 and they are not interchangeable. `partnerId` is
 * the same for both — an employee sees the business's bookings and calendars, which is the point —
 * but the OWNER'S OWN surfaces are not theirs: the partnership agreement and the verification
 * the contract is guarded by `PARTNER_CONTRACT_SIGN_OWN`, and an
 * employee holds neither.
 *
 * Without this, an employee reaching العقود والمستندات gets two 403s, `partnerFetch` reports them
 * as `'unauthenticated'` — deliberately, because a page cannot usefully distinguish them — and the
 * screen says «انتهت الجلسة». That sends somebody to sign in again over a permission, which will
 * not help and cannot be got out of. An employee of an UNVERIFIED partner is redirected here by
 * the gate, so it is a loop rather than a wrong sentence.
 *
 * ## Read from the SESSION, not from the profile
 *
 * `/partner/me` answers about the BUSINESS and returns the same thing to both roles. The role is a
 * property of the reader, and the only place that knows it is their own token.
 *
 * This is not a security boundary and must not be mistaken for one: the API refuses an employee at
 * those routes on its own authority. This decides which SENTENCE to show instead of a refusal.
 */
export async function isEmployeeReader(): Promise<boolean> {
  const session = await getPartnerSession();

  return session?.user.role === 'partner_employee';
}

/**
 * Whether this reader may open a section, and if not, which sentence to tell them.
 *
 * ## A hidden nav item is not an access control
 *
 * The sidebar stops an employee FINDING a section; it does nothing about a bookmark, a pasted link
 * or a typed URL. Every gated page needs its own branch, and it has to run BEFORE the fetch —
 * otherwise the API answers 403, `partnerFetch` reports that as `'unauthenticated'`, and the screen
 * says «انتهت الجلسة» to somebody whose session is perfectly good. Signing in again cannot help.
 *
 * ## Two refusals, because they call for different actions
 *
 * `owner` — no role can ever carry this capability (مستحقاتي, العقود, الموظفون). Asking the
 * employer would be pointless, so the sentence closes the subject.
 *
 * `role` — an employee COULD hold this and does not (عقاراتي, التقويمات, التقييمات). The person
 * who can change it is one conversation away, and the sentence says so.
 *
 * Derived from `PARTNER_EMPLOYEE_PERMISSIONS` rather than listed by hand, so a capability moving
 * into or out of the employee allow-list changes the sentence automatically instead of leaving one
 * screen telling somebody a thing is impossible when it has just become grantable.
 *
 * ## Not the security boundary
 *
 * The token is decoded, not verified, and every route is refused by the API on its own authority.
 * This decides which sentence a reader sees INSTEAD of a refusal they cannot act on.
 */
export type SectionAccess = 'open' | 'owner' | 'role';

export async function sectionAccess(section: PartnerSection): Promise<SectionAccess> {
  const session = await getPartnerSession();
  const permissions = session ? sessionPermissions(session) : [];

  if (canOpenSection(permissions, PARTNER_SECTION_PERMISSIONS, section)) return 'open';

  const required = PARTNER_SECTION_PERMISSIONS[section];
  const grantable = (PARTNER_EMPLOYEE_PERMISSIONS as readonly string[]).includes(
    required,
  );

  return grantable ? 'role' : 'owner';
}

/**
 * Every section this reader can open, in nav order — for deciding where to LAND them.
 *
 * A role carrying only `booking.respond_as_partner` and `review.respond_own` opens nothing: both
 * are in-page actions on screens their other capabilities do not reach, and both are boxes somebody
 * would reasonably tick. `sections.test.ts` pins that case. An empty overview of a business you
 * cannot see is indistinguishable from a broken portal, so the caller has to handle the empty
 * answer deliberately rather than rendering a dashboard with nothing in it.
 */
export async function readerSections(): Promise<string[]> {
  const session = await getPartnerSession();

  return openableSections(
    session ? sessionPermissions(session) : [],
    PARTNER_SECTION_PERMISSIONS,
  );
}

/**
 * Where each section lives, for landing a reader who cannot open the dashboard.
 *
 * A LITERAL map, never a path built from a request — this feeds `redirect()`, and a destination
 * derived from anything a caller controls is an open redirect on the first screen of the portal.
 * The same reasoning `ONBOARDING_PATH` records.
 *
 * Keyed by `PartnerSection`, so a section added to the shared map without a route here fails to
 * compile rather than redirecting to `undefined`.
 */
export const SECTION_PATH: Record<PartnerSection, string> = {
  dashboard: '/',
  properties: '/properties',
  calendars: '/calendars',
  reviews: '/reviews',
  arrivals: '/arrivals',
  violations: '/violations',
  payouts: '/payouts',
  payoutAccounts: '/payouts/accounts',
  contracts: '/contracts',
  coupons: '/coupons',
  employees: '/employees',
  employeeRoles: '/employee-roles',
};
