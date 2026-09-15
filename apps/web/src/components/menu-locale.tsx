'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { Flag } from '@/components/flags';
import { LOCALE_LABELS, type Locale, routing } from '@/i18n/routing';
import { swapLocale } from '@/lib/locale-path';

/**
 * The LANGUAGE list inside the phone menu — open, not behind a second press.
 *
 * A currency list sat beside it until 2026-09-14, when Bashar reduced the platform to one currency.
 *
 * ## Why not `HeaderMenus`, which already does this
 *
 * Because it opens a popup, and this is already inside one. Two `Modal`s on screen at once means
 * two focus traps competing, an Escape that closes an ambiguous one of them, and two scroll locks
 * whose cleanup order decides whether the page can be scrolled afterwards. The menu was shipped
 * without these controls for that reason and Bashar asked for them anyway (2026-09-03: «I do not
 * see the current language and currency inside it»), so they are here as LISTS rather than as
 * triggers — which removes the nesting instead of managing it.
 *
 * It is also the better answer on a phone. A trigger shows the current value and hides the
 * alternatives; three chips show the current value AND what else there is, in the same space, and
 * change it in one press instead of two.
 *
 * ## Language is navigation
 *
 * Real anchors carrying `hrefLang`, so a press is an ordinary navigation that keeps the reader's
 * page. The currency half was a POSTing form instead — a `<Link>` writing a cookie would have
 * fired on Next's prefetch — and it went with the currencies.
 *
 * ## The path comes from the BROWSER
 *
 * `usePathname()`, not a header the middleware set: `x-safra-pathname` is absent on any path
 * containing a dot and stale in a cached render, and its fallback was the home page — so the
 * control that exists to keep a reader in place sent them to the front door instead. Reading the
 * query string is why this needs the Suspense boundary; it opts the subtree out of prerendering.
 */
export function MenuLocale({
  locale,
  labels,
}: {
  readonly locale: Locale;
  readonly labels: { language: string };
}) {
  return (
    <Suspense fallback={null}>
      <Controls locale={locale} labels={labels} />
    </Suspense>
  );
}

function Controls({
  locale,
  labels,
}: {
  readonly locale: Locale;
  readonly labels: { language: string };
}) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const suffix = query ? `?${query}` : '';

  return (
    <div className="mt-2 grid gap-4 border-t border-line pt-4">
      <section>
        <Heading>{labels.language}</Heading>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {routing.locales.map((code) => (
            <Link
              key={code}
              href={`${swapLocale(pathname, code)}${suffix}`}
              hrefLang={code}
              aria-current={code === locale ? 'true' : undefined}
              className={chip(code === locale)}
            >
              <Flag locale={code} className="h-3.5 w-5" />
              {LOCALE_LABELS[code]}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * One chip, current or not.
 *
 * The current one is filled rather than merely coloured. A phone is read in daylight at arm's
 * length, and «which of these three am I on» has to survive that — a gold word among two grey ones
 * does not, and it is the whole question this section was added to answer.
 *
 * 44px tall, because these are the smallest targets in the menu and a finger does not get smaller
 * for being offered a smaller control.
 */
function chip(current: boolean) {
  return `inline-flex min-h-12 items-center gap-2 rounded-lg border px-3 text-[14px] font-semibold transition-colors duration-200 ease-out-strong ${
    current
      ? 'border-gold bg-gold/12 text-gold-read'
      : 'border-line text-muted hover:border-gold/50 hover:text-text'
  }`;
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-bold text-faint">{children}</h3>;
}
