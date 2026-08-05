import { defineRouting } from 'next-intl/routing';

import { DEFAULT_LOCALE, LOCALES } from '@safra/i18n';

/**
 * next-intl's routing, built FROM the platform's locale registry.
 *
 * §1.4 requires Arabic, English and German from launch, with RTL for Arabic.
 *
 * Arabic is the DEFAULT and its prefix is always shown (`/ar/...`). Hiding the default
 * locale's prefix would give the same page two URLs, which splits SEO signals — and §5.4 makes
 * city pages an explicit SEO target, so every page gets exactly one canonical address per
 * language.
 *
 * ## Why the list is no longer written here
 *
 * It was, and that made the customer app the authority on how many languages SAFRA speaks —
 * while the staff console, the transactional emails and the API's error text each needed the
 * same answer. Adding a language meant finding every copy of that list. `@safra/i18n` now owns
 * it, and everything else, this file included, derives from it.
 *
 * `LOCALES` is spread because `defineRouting` wants a mutable array and the registry is
 * `readonly` — deliberately, so nothing can push a locale onto it at runtime.
 */
export const routing = defineRouting({
  locales: [...LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
});

export {
  type Locale,
  LOCALE_DIRECTION,
  LOCALE_LABELS,
  isLocale,
  resolveLocale,
} from '@safra/i18n';
