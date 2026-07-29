import { defineRouting } from 'next-intl/routing';

/**
 * §1.4 requires Arabic, English and German from launch, with RTL for Arabic.
 *
 * Arabic is the DEFAULT and its prefix is always shown (`/ar/...`). Hiding the
 * default locale's prefix would give the same page two URLs, which splits SEO
 * signals — and §5.4 makes city pages an explicit SEO target, so every page gets
 * exactly one canonical address per language.
 */
export const routing = defineRouting({
  locales: ['ar', 'en', 'de'],
  defaultLocale: 'ar',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];

/** Text direction per locale. Arabic is the only RTL language at launch. */
export const LOCALE_DIRECTION: Record<Locale, 'rtl' | 'ltr'> = {
  ar: 'rtl',
  en: 'ltr',
  de: 'ltr',
};

/** Names shown in the language switcher, each written in its own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  ar: 'العربية',
  en: 'English',
  de: 'Deutsch',
};

export function isLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}
