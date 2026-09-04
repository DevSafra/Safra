import { DIAL_COUNTRIES } from '@/lib/dial-codes';
import type { Locale } from '@/i18n/routing';

export interface DialOption {
  readonly code: string;
  readonly dial: string;
  readonly name: string;
}

/**
 * The country list a phone field shows, named and ordered — **built on the server, once**.
 *
 * ## Why this is not done inside the field
 *
 * It was, and it produced a hydration mismatch on every form that has a phone number: register,
 * checkout, the profile and the partner application. `PhoneField` sorted 245 names with
 * `new Intl.Collator(locale)` during render, so the sort ran once on the server and again in the
 * browser — and **the two do not agree**, because they are different ICU builds. Measured on
 * 2026-09-03: Node put «الأراضي الفلسطينية» before «الأرجنتين» and Chromium did not, React reported
 * error #418, and it re-rendered the subtree to repair itself.
 *
 * That is structural rather than a bug in one engine. A server runs one ICU; visitors run dozens.
 * Any list ordered with ICU on both sides will disagree with SOME browser, and the disagreement
 * will be invisible in testing because it depends on the visitor's version.
 *
 * Sorting without ICU was considered and rejected: code-point order puts «Ägypten» after «Zypern»
 * in German and scatters the Arabic hamza forms, which is exactly the findability this ordering
 * exists for. So the list is built ONCE, here, on the server, and handed to the field as data.
 *
 * ## The names are `Intl.DisplayNames`, and that stays
 *
 * 245 names × 3 locales is not copy anybody would translate by hand, and `docs/i18n.md` makes the
 * same documented exception for weekday and month names. Resolving them here rather than in the
 * browser has the same benefit as the sort: one answer, the server's.
 *
 * ## The three launch markets lead
 *
 * They are where most customers are, and a separator row would need `<optgroup>` copy in three
 * locales to say so; being first says it.
 */
export function dialOptions(locale: Locale): DialOption[] {
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  const collator = new Intl.Collator(locale);
  const PINNED = ['SY', 'JO', 'LB'];

  return [...DIAL_COUNTRIES]
    .map((entry) => ({
      code: entry.code,
      dial: entry.dial,
      name: names.of(entry.code) ?? entry.code,
    }))
    .sort((a, b) => {
      const aPinned = PINNED.indexOf(a.code);
      const bPinned = PINNED.indexOf(b.code);

      if (aPinned !== -1 || bPinned !== -1) {
        if (aPinned !== -1 && bPinned !== -1) return aPinned - bPinned;

        return aPinned !== -1 ? -1 : 1;
      }

      return collator.compare(a.name, b.name);
    });
}
