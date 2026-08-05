import { getRequestConfig } from 'next-intl/server';

import { resolveLocale, webMessages, type WebMessages } from '@safra/i18n';

/**
 * Per-request locale and messages for next-intl.
 *
 * The catalogues live in `@safra/i18n` rather than beside this file, so the customer copy sits
 * with the console's, the emails' and the API error text's — one place answering "what does
 * SAFRA say to people", which is what makes adding a language a finishable task.
 *
 * `webMessages` resolves them with a static import per locale, so the dynamic
 * `import(\`./messages/${locale}.json\`)` this used to do is gone. That form silently typed the
 * result as `Record<string, unknown>`, which is why the augmentation below never worked before.
 */

/**
 * Makes `useTranslations` key-checked against the Arabic catalogue.
 *
 * Without this, `t('hoem.title')` is a valid call that renders the key itself at runtime. With
 * it, that is a compile error — which matters most for the keys nobody clicks through during
 * review.
 */
declare module 'next-intl' {
  interface AppConfig {
    Messages: WebMessages;
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  // An unknown or missing locale falls back rather than 404s: a stale link or a truncated URL
  // should still render a usable page.
  const locale = resolveLocale(await requestLocale);

  return {
    locale,
    messages: webMessages(locale),
    // The launch markets are all UTC+2/+3; per-city timezones are handled by the API for the
    // booking cutoff, not by message formatting.
    timeZone: 'Asia/Damascus',
  };
});
