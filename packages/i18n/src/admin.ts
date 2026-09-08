import type { Locale } from './locales.js';
import { statusWords, type StatusVocabulary } from './statuses.js';
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

/**
 * The Arabic word for a coded payload value, resolved the way سجل التدقيق resolves it.
 *
 * ## Why this lives here rather than in the console
 *
 * Because two things read it and they must not disagree: the console's `payloadValue`, which draws
 * the «قبل» and «بعد» columns, and `audit-catalogue.integration.test.ts`, which walks every value
 * the platform has actually WRITTEN and fails when one has no word. A guard that resolved codes
 * differently from the screen it guards would pass over exactly the identifiers a reader meets.
 *
 * ## Field first, then the general map
 *
 * A code whose meaning depends on its field — `partner` is «نسخة الشريك الموقّعة» under `party` and
 * «الشريك» under `filedBy` — is resolved by `payloadValueByKey`. Everything else, which is most of
 * it, comes from the flat map. `null` when neither knows it, so a caller can tell «no word» from a
 * word that happens to equal the code.
 */
export function payloadWord(
  key: string,
  value: string,
  subjectType?: string,
): string | null {
  const messages = adminMessages('ar');

  /*
    `status` is the one field a per-field map cannot resolve, and the SUBJECT settles it.

    Seven vocabularies write to it — a booking's, a listing's, a dispute's, a payout's, a payout
    account's, a gift card's, a payment's — and `rejected` means «مرفوض» for a listing and «محسوم
    لصالح الشريك» for a dispute. A field-keyed entry would have to choose one and be confidently
    wrong on six screens, which is worse than printing the code. The audit row knows what it is
    ABOUT, so the vocabulary is decided by that and the answer is right on all seven.

    Only for `status`: every other field either means one thing or is listed in `payloadValueByKey`.
  */
  if (key === 'status' && subjectType !== undefined) {
    const vocabulary = STATUS_BY_SUBJECT[subjectType];
    const word = vocabulary ? statusWords(vocabulary, 'ar')[value] : undefined;

    if (word !== undefined) return word;
  }

  return (
    messages.enums.payloadValueByKey[key]?.[value] ??
    messages.enums.payloadValue[value] ??
    null
  );
}

/**
 * Which canonical vocabulary a subject's `status` belongs to.
 *
 * Written out rather than derived from the type name: `partner_contract` would need a convention
 * and `gift_card` another, and a convention nobody can see is one nobody maintains. A subject not
 * listed here falls through to the general map, which is today's behaviour — it prints something
 * rather than nothing.
 */
const STATUS_BY_SUBJECT: Readonly<Record<string, StatusVocabulary>> = {
  booking: 'bookingStatus',
  dispute: 'disputeStatus',
  property: 'propertyStatus',
  payout: 'payoutStatus',
  payout_account: 'payoutAccountStatus',
  gift_card: 'giftCardStatus',
  payment: 'paymentStatus',
};
