import type { Locale } from './locales.js';
import { ar } from './messages/admin/ar.js';
import type { Translated } from './shape.js';

/**
 * The staff console's copy.
 *
 * ## Why this is `Partial` and the customer app's is not
 *
 * The customer app serves all three launch locales and its catalogues are required to be
 * complete — a missing German key there is a German customer reading Arabic. The staff
 * console is Arabic-only by decision (Bashar, 2026-08-03), and writing 800 unreviewed English
 * and German strings to satisfy a type would produce a console that LOOKS translated and
 * reads as machine output to the people who run the business on it.
 *
 * So the shape is honest about the state: Arabic exists, the others do not yet, and
 * `ADMIN_LOCALES` says which. Adding one is a single file that the compiler then checks
 * key-by-key against `AdminMessages` — which is the whole reason the copy moved here.
 */
export type AdminMessages = Translated<typeof ar>;

/**
 * The Arabic catalogue with its LITERAL types intact.
 *
 * Exported separately, and this is the one subtlety in the package. `adminMessages()` returns
 * the widened `AdminMessages`, because a registry holding three languages cannot promise any
 * particular string. But widening also erases what `fill()` reads placeholder names out of,
 * so `fill(t.staff.inviteSent, { emial })` would stop being a typo the compiler catches.
 *
 * While the console has exactly one language there is no reason to pay that. The app binds
 * `t` to this, keeps full placeholder checking on all 22 interpolated call sites, and switches
 * to `adminMessages(locale)` in ONE line when a second language arrives — at which point the
 * checking degrades to the `completeness` tests rather than disappearing.
 */
export const adminAr = ar;

const CATALOGUES: Partial<Record<Locale, AdminMessages>> = { ar };

/**
 * Which console locales are actually translated.
 *
 * Derived from the registry rather than written out, so it cannot disagree with what exists.
 */
export const ADMIN_LOCALES = Object.keys(CATALOGUES) as readonly Locale[];

/**
 * The console catalogue for a locale, falling back to Arabic.
 *
 * The fallback is whole-catalogue, not per-key: a half-translated console that switches
 * language mid-screen is harder to use than one consistently in a language you can read.
 */
export function adminMessages(locale: Locale): AdminMessages {
  return CATALOGUES[locale] ?? ar;
}
