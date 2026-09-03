'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { LOCALE_LABELS, type Locale, routing } from '@/i18n/routing';
import { swapLocale } from '@/lib/locale-path';

/**
 * «اعرض الموقع بهذه اللغة» — the language control.
 *
 * ## Why this reads the path in the BROWSER
 *
 * It used to take the pathname as a prop, which the footer read from an `x-safra-pathname` header
 * the middleware sets — a server component cannot ask Next for the current path. That works until
 * the header is absent or fails validation, and then the fallback is `/${locale}`: the HOME page.
 * So the control that exists to keep a reader in place sent them to the front door instead
 * (Bashar, 2026-08-18: "it should navigate nowhere when I change the language, just stay on the
 * current page").
 *
 * The header could go missing for more than one reason — the middleware matcher excludes any path
 * containing a dot, a cached render carries whatever path first produced it — and each is a
 * separate thing to get right. `usePathname()` is the browser's own answer and cannot be stale,
 * absent, or somebody else's.
 *
 * ## The query string comes too
 *
 * `usePathname` is the path alone, so a reader on `/ar/search?city=damascus&guests=2` would have
 * kept their PAGE and lost their SEARCH. `useSearchParams` puts it back, which is why this needs
 * the Suspense boundary below: it opts the subtree out of static prerendering, and without one
 * Next refuses to build the pages that use it.
 */
export function LanguagePicker({
  locale,
  label,
  help,
}: {
  readonly locale: Locale;
  readonly label: string;
  readonly help: string;
}) {
  return (
    <Suspense fallback={<Summary locale={locale} label={label} />}>
      <Picker locale={locale} label={label} help={help} />
    </Suspense>
  );
}

/** The closed control, also the fallback while the query string is being read. */
function Summary({ locale, label }: { readonly locale: Locale; readonly label: string }) {
  return (
    <summary
      aria-label={label}
      className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm text-text2 transition-colors hover:border-gold/50 hover:text-gold"
    >
      <span aria-hidden>🌐</span>
      {LOCALE_LABELS[locale]}
    </summary>
  );
}

function Picker({
  locale,
  label,
  help,
}: {
  readonly locale: Locale;
  readonly label: string;
  readonly help: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  /*
    The locale is swapped on the PATH, and the query re-attached afterwards.

    Not `swapLocale(`${pathname}?${search}`)`: that function splits on `/`, so a query would ride
    along on the final segment and, on a bare `/ar?x=1`, the first segment would read `ar?x=1`,
    match no locale, and produce `/en/ar?x=1`.
  */
  const href = (code: Locale) => {
    const swapped = swapLocale(pathname, code);

    return search ? `${swapped}?${search}` : swapped;
  };

  return (
    /*
      `name` makes the two pickers an exclusive group — opening one closes the other, with no
      script. Without it both can be open at once, and on a phone the panels overlap because they
      both open upward from the same row.
    */
    <details name="footer-picker" className="relative">
      <Summary locale={locale} label={label} />

      {/*
        `w-max`, not `min-w-*`. An absolutely positioned box shrinks to fit its CONTAINING BLOCK —
        here the `<details>`, which is as wide as the little summary — so a minimum width let the
        panel be narrower than its own help line and clip it. `bottom-full` opens it UPWARD: a menu
        at the foot of the page that opened downward would render below the viewport.
      */}
      <ul className="absolute bottom-full start-0 z-20 mb-2 w-max max-w-[min(16rem,80vw)] rounded-lg border border-line bg-card p-1 shadow-lg">
        <li className="px-2 py-1 text-[11px] leading-snug text-faint">{help}</li>
        {routing.locales.map((code) => (
          <li key={code}>
            <Link
              href={href(code)}
              hrefLang={code}
              aria-current={code === locale ? 'true' : undefined}
              className={`flex min-h-10 items-center rounded-lg px-2 text-sm transition-colors lg:min-h-9 ${
                code === locale
                  ? 'bg-field font-semibold text-gold-ink'
                  : 'text-muted hover:bg-field hover:text-gold'
              }`}
            >
              {LOCALE_LABELS[code]}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
