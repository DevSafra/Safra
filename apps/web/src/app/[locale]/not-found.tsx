import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { ORNAMENT_BRAND } from '@safra/ui';

/**
 * A 404 inside the site, rather than instead of it.
 *
 * ## What it covers, and what it deliberately does not
 *
 * It renders for a `notFound()` thrown inside the locale segment — a property reference that does
 * not exist, a booking that was deleted. Those were already served as Next's `<html
 * id="__next_error__">` shell with the UI in the RSC payload, so they gain the site's chrome here
 * and lose nothing.
 *
 * An UNMATCHED path — `/ar/no-such-page` — still falls to the root `app/not-found.tsx`, and that is
 * deliberate. A catch-all route was written on 2026-09-04 to bring those inside this layout, and it
 * was measured and REMOVED: it turned an unmatched path from a `notFound()` at ROUTING time, which
 * Next server-renders in full, into one at REQUEST time, which it does not. The rendered body went
 * from the whole page to twelve characters with JavaScript disabled. That trade is wrong on a
 * public, indexable surface.
 *
 * What the catch-all was fixing is real and is now a known, measured residual rather than a guess:
 * an unmatched path's 404 carries sixteen `<script>` tags and no CSP nonce, so the browser refuses
 * them. Nothing on the root 404 needs them — it is one heading, three lines and a link, with inline
 * styles — so the cost is console noise rather than a broken page. Closing it properly means
 * getting a nonce into a render that happens outside the request pipeline, which is a Next-level
 * problem. Recorded in `docs/FUTURE-WORK.md`.
 *
 * ## And it is a better 404
 *
 * Inside the layout it has the site's own header and footer, so a reader who has just hit a dead
 * link has search, their language and their currency to hand — which is what somebody in that
 * position actually wants. It speaks ONE language, theirs, because by this point there is a locale
 * to read; the root fallback speaks all three precisely because there is not.
 */
export default async function LocaleNotFound() {
  const t = await getTranslations('notFound');
  const locale = await getLocale();

  return (
    <section className="mx-auto grid w-full max-w-2xl place-items-center gap-4 px-4 py-16 text-center sm:py-24">
      <p className="text-3xl text-gold" aria-hidden>
        {ORNAMENT_BRAND}
      </p>

      <h1 className="text-2xl font-bold text-text sm:text-3xl">{t('title')}</h1>

      <p className="max-w-prose text-[0.9375rem] leading-relaxed text-text2">
        {t('body')}
      </p>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        {/*
          Search FIRST: somebody on a dead property link wants another property, not the home page.

          Both are `min-h-11` with `inline-flex`, because `min-height` does nothing to an inline
          element — an anchor styled as a control has to be told it is a box.
        */}
        <Link
          href={`/${locale}/search`}
          className="inline-flex min-h-11 items-center rounded-lg bg-gold px-5 text-sm font-bold text-ink transition-opacity duration-200 ease-out-strong hover:opacity-90"
        >
          {t('search')}
        </Link>

        <Link
          href={`/${locale}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-text2/30 bg-field px-5 text-sm font-semibold text-text transition-colors duration-200 ease-out-strong hover:border-gold hover:bg-gold/10"
        >
          {t('home')}
        </Link>
      </div>
    </section>
  );
}
