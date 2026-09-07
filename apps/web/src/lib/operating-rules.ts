import { getTranslations } from 'next-intl/server';

import { confirmationWindowMinutes, durationParts } from '@safra/contracts';

import { getPublicSettings } from '@/lib/catalog';

/**
 * «خلال ساعتين», as long as it actually is.
 *
 * Bashar, 2026-09-07: operational values *"should always be derived from the active configuration
 * rather than embedded in static strings"*. Five customer surfaces stated the confirmation window
 * as a literal — the home page's «كيف تعمل سفرة», the property page's not-instant notice, the
 * checkout note, and the pending-booking steps on two screens — every one of them «ساعتان», which
 * is correct at 120 minutes and wrong at any other value.
 *
 * ## Why a helper rather than three lines per page
 *
 * Because it was three lines per page, five times: read the settings, split the duration, pick the
 * ICU message. Five copies of a composition drift the way two catalogues describing one event
 * drift — not on the day they are written, on the day one of them is changed.
 *
 * ## The ICU message, not a template
 *
 * «ساعتين» is Arabic DUAL. Ninety minutes is not a whole number of hours, two hundred and forty is
 * not «ساعتين», and Arabic has six plural forms to choose between — so `durationParts` decides only
 * the unit and the count, and the catalogue's `common.durationHours` / `common.durationMinutes`
 * know the forms. A `${n} ساعة` template would freeze English grammar into a language that does not
 * share it, which `docs/i18n.md` forbids outright.
 *
 * ## A caller that already has the settings passes them
 *
 * The home page and the checkout load `getPublicSettings()` for the fee, so re-reading it here
 * would be a second round trip for a value already in hand. It is a 300-second cached read either
 * way, which is why the parameter is optional rather than required.
 */
export async function confirmationWindowLabel(
  settings?: Record<string, unknown>,
): Promise<string> {
  const [rules, t] = await Promise.all([
    settings ? Promise.resolve(settings) : getPublicSettings(),
    getTranslations('common'),
  ]);

  const window = durationParts(confirmationWindowMinutes(rules));

  return t(window.unit === 'hours' ? 'durationHours' : 'durationMinutes', {
    count: window.count,
  });
}
