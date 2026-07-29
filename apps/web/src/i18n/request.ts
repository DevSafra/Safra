import { getRequestConfig } from 'next-intl/server';

import { isLocale, routing } from './routing';

/**
 * Typed JSON import. A bare dynamic import is `any`, and reading `.default` off it
 * silently defeats the type checking the rest of the app relies on.
 */
async function loadMessages(locale: string): Promise<Record<string, unknown>> {
  const loaded = (await import(`./messages/${locale}.json`)) as {
    default: Record<string, unknown>;
  };

  return loaded.default;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;

  // An unknown or missing locale falls back rather than 404s: a stale link or a
  // truncated URL should still render a usable page.
  const locale = requested && isLocale(requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
    // The launch markets are all UTC+2/+3; per-city timezones are handled by the
    // API for the booking cutoff, not by message formatting.
    timeZone: 'Asia/Damascus',
  };
});
