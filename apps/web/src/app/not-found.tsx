import Link from 'next/link';

import { DEFAULT_LOCALE, LOCALES, LOCALE_DIRECTION, webMessages } from '@safra/i18n';
import { ORNAMENT_BRAND } from '@safra/ui';

/**
 * The tab's name, in every language this page speaks.
 *
 * A root `not-found` renders outside the locale layout, so it inherits no metadata — the tab said
 * «localhost:3000» and the history entry had no name. Arabic first, as every SAFRA message is.
 */
export const metadata = {
  title: LOCALES.map((locale) => webMessages(locale).notFound.title).join(' · '),
};

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
 *
 * **The LIGHT values, not `@theme`'s own.** Those defaults are the night palette — the light theme
 * overrides them under `:root:not([data-theme='dark'])` — so copying them gave a near-black page
 * to a site whose default is white (Bashar's instruction: the default is always white, never the
 * operating system's preference). A visitor who mistyped a URL got a screen that looked like a
 * different product.
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
          background: '#f5f6fa',
          color: '#1d2333',
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: '#a87a1f', fontSize: '2rem', margin: 0 }} aria-hidden>
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
              style={{ color: '#454b5a', fontSize: '0.9rem', margin: '0.25rem 0 0' }}
            >
              {webMessages(locale).notFound.title}
            </p>
          ))}

          <Link
            href={`/${DEFAULT_LOCALE}`}
            /*
              20px and bold, which is not decoration: `--gold` on the page ground is 3.56:1, under
              the 4.5 body-text floor and over the 3.0 one WCAG sets for large text (≥18.66px bold).
              Darkening the gold was the other way to clear it and Bashar has rejected that twice —
              the brand colour is the design's, and the greys are where readability was bought. So
              the one control on this page is sized like the one control on this page.
            */
            style={{
              color: '#a87a1f',
              display: 'inline-block',
              marginTop: '1.25rem',
              fontSize: '1.25rem',
              fontWeight: 700,
            }}
          >
            {fallback.notFound.home}
          </Link>
        </div>
      </body>
    </html>
  );
}
