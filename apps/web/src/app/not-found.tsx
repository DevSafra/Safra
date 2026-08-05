import Link from 'next/link';

import { DEFAULT_LOCALE, LOCALES, LOCALE_DIRECTION, webMessages } from '@safra/i18n';
import { ORNAMENT_BRAND } from '@safra/ui';

/**
 * Root-level 404, for a request that never matched a `/[locale]/…` segment.
 *
 * ## Why this page is multilingual rather than translated
 *
 * There is no locale to read. The URL did not carry one — that is why this page is rendering —
 * so there is nothing to negotiate and no `useTranslations` context to use. Guessing from
 * `Accept-Language` would be a guess, and guessing wrong on the one page whose whole job is to
 * point someone back to the site is a bad trade.
 *
 * So it says the same thing in every locale SAFRA serves: the default prominently, the others
 * underneath. Adding a language adds a line here automatically, because the list comes from
 * the registry rather than from this file.
 *
 * ## Why the styles are inline
 *
 * A root `not-found` renders outside the locale layout, which is where Tailwind's stylesheet is
 * linked. Inline styles are the only ones guaranteed to arrive. The palette values are
 * duplicated from `@theme` deliberately — a 404 that renders unstyled looks broken, and a
 * broken-looking 404 reads as "the site is down" rather than "that page moved".
 */
export default function NotFound() {
  const direction = LOCALE_DIRECTION[DEFAULT_LOCALE];
  const fallback = webMessages(DEFAULT_LOCALE);
  const others = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

  return (
    <html lang={DEFAULT_LOCALE} dir={direction}>
      <body
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#0C0A1C',
          color: '#F4EEDF',
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: '#E8BC66', fontSize: '2rem', margin: 0 }} aria-hidden>
            {ORNAMENT_BRAND}
          </p>

          <h1 style={{ fontSize: '1.25rem', marginTop: '1rem' }}>
            {fallback.notFound.title}
          </h1>

          {others.map((locale) => (
            <p
              key={locale}
              lang={locale}
              dir={LOCALE_DIRECTION[locale]}
              style={{ color: '#A9A3C4', fontSize: '0.9rem', margin: '0.25rem 0 0' }}
            >
              {webMessages(locale).notFound.title}
            </p>
          ))}

          <Link
            href={`/${DEFAULT_LOCALE}`}
            style={{ color: '#E8BC66', display: 'inline-block', marginTop: '1rem' }}
          >
            {fallback.notFound.home}
          </Link>
        </div>
      </body>
    </html>
  );
}
