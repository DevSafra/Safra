import type { Locale } from './locales.js';
import ar from './messages/web/ar.json' with { type: 'json' };
import de from './messages/web/de.json' with { type: 'json' };
import en from './messages/web/en.json' with { type: 'json' };
import type { Translated } from './shape.js';

/**
 * The customer site's copy, per locale.
 *
 * ## Why these three are JSON while the rest of the package is TypeScript
 *
 * next-intl reads them natively and resolves ICU — which customer copy genuinely needs and
 * the other surfaces do not: plurals ("1 night" / "2 nights" / Arabic's six forms), dates,
 * and currency all belong to the formatter rather than to three hand-written variants. JSON
 * is also what a translation service accepts, and these are the catalogues that will actually
 * be sent to one.
 *
 * The cost is that `fill()`'s placeholder type-checking does not apply here. next-intl covers
 * the same ground differently: the `AppConfig` augmentation in `apps/web/src/i18n/request.ts`
 * makes `t('typo')` a compile error, and ICU arguments are checked against the message.
 *
 * ## Static imports, not `import(\`./messages/${locale}.json\`)`
 *
 * The dynamic form worked while the files sat next to the loader; across a package boundary
 * it needs a wildcard subpath export and bundler cooperation to resolve a template. All three
 * catalogues together are a few kilobytes and this only ever runs on the server, so the
 * static form costs nothing and cannot break at runtime on a locale nobody tested.
 */
export type WebMessages = Translated<typeof ar>;

const CATALOGUES: Record<Locale, WebMessages> = { ar, en, de };

/** The customer catalogue for a locale. */
export function webMessages(locale: Locale): WebMessages {
  return CATALOGUES[locale];
}

/** The customer catalogues, for the completeness tests and for next-intl's loader. */
export const WEB_CATALOGUES: Readonly<Record<Locale, WebMessages>> = CATALOGUES;
