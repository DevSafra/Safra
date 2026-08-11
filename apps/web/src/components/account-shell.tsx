import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { SignOutButton } from '@/components/sign-out-button';
import type { AccountSummary } from '@/lib/account';
import { dynamicMessage } from '@/lib/dynamic-message';
import { formatMoney } from '@/lib/localise';
import type { Locale } from '@/i18n/routing';

/**
 * The customer account frame — handoff §6.
 *
 * The spec is specific: a LEFT SIDEBAR of eight items with a gold active state and badges on three
 * of them, and a page title that changes per section. This renders that frame; each section renders
 * its own title and body inside it.
 *
 * ## A component, not a `layout.tsx`
 *
 * The same call the console makes, for the same reason: the badges are per-section data, and a
 * layout cannot receive them from the page beneath it — it would have to fetch the counters itself
 * on every navigation, a second round trip for numbers the page has usually already loaded.
 *
 * ## Every section is a real link, including the three that are not built
 *
 * §6 lists eight. Three have no data behind them yet, and they navigate to a page that NAMES what is
 * missing rather than to a dimmed dead end. That is the console's choice inverted deliberately: it
 * dims its unbuilt sections because there are eleven of them, whereas three sections each able to
 * explain themselves in a sentence are more useful as links than as greyed text.
 */

export type AccountSection =
  | 'overview'
  | 'bookings'
  | 'wallet'
  | 'gifts'
  | 'favourites'
  | 'reviews'
  | 'invoices'
  | 'profile';

/** §6's order, which is the order the design lists and therefore the one to learn. */
const SECTIONS: readonly { readonly id: AccountSection; readonly path: string }[] = [
  { id: 'overview', path: '' },
  { id: 'bookings', path: '/bookings' },
  { id: 'wallet', path: '/wallet' },
  { id: 'gifts', path: '/gifts' },
  { id: 'favourites', path: '/favourites' },
  { id: 'reviews', path: '/reviews' },
  { id: 'invoices', path: '/invoices' },
  { id: 'profile', path: '/profile' },
];

/** Which nav label each section uses. Separate from the id so the catalogue keys stay explicit. */
const LABEL_KEY: Record<AccountSection, string> = {
  overview: 'navOverview',
  bookings: 'navBookings',
  wallet: 'navWallet',
  gifts: 'navGifts',
  favourites: 'navFavourites',
  reviews: 'navReviews',
  invoices: 'navInvoices',
  profile: 'navProfile',
};

export async function AccountShell({
  locale,
  active,
  title,
  summary,
  children,
}: {
  readonly locale: Locale;
  readonly active: AccountSection;
  /** §6: "Page title changes per section" — the overview passes «أهلاً {name}». */
  readonly title: string;
  /**
   * The reader's summary, or null when the read failed.
   *
   * The badges are derived HERE rather than passed in, so no section has to remember the rules — and
   * every section shows the same three. They used to be assembled by the overview alone, which meant
   * they vanished the moment you navigated anywhere else: a badge that disappears reads as a glitch,
   * not as an absence.
   *
   * Null is not an error. A sidebar that refused to render because a counter could not be read would
   * be worse than one without badges, which is the same call the console makes about preferences.
   */
  readonly summary: AccountSummary | null;
  readonly children: React.ReactNode;
}) {
  const t = await getTranslations('account');

  /*
    §6 marks exactly three items. Each is omitted rather than shown as «0»: an absent badge says
    "nothing here", where a zero says "we counted, and it is none" — and for the wallet, a customer
    with no wallet row has no balance rather than a balance of nothing.
  */
  const badges = {
    ...(summary && summary.counters.bookings > 0
      ? { bookings: String(summary.counters.bookings) }
      : {}),
    ...(summary?.counters.walletBalance && summary.counters.walletCurrency
      ? {
          wallet: formatMoney(
            summary.counters.walletBalance,
            summary.counters.walletCurrency,
            locale,
          ),
        }
      : {}),
    ...(summary && summary.counters.pendingReviews > 0
      ? { reviews: String(summary.counters.pendingReviews) }
      : {}),
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 print:block print:max-w-none print:p-0 lg:grid-cols-[220px_1fr] lg:items-start">
      {/*
        The nav comes FIRST in the DOM and moves into column one from `lg` up.

        Below `lg` it is a horizontally scrolling strip rather than a stacked block, and that is a
        considered departure from "content before navigation": the rule exists because nineteen
        stacked console links pushed every section below the fold, which a single 40px tab row does
        not do. It scrolls inside its own box, so the page still never scrolls sideways.
      */}
      {/* `print:hidden` — screen navigation. On paper the reader already holds the document. */}
      <nav
        aria-label={t('navHeading')}
        className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 print:hidden lg:mx-0 lg:col-start-1 lg:row-start-1 lg:flex-col lg:px-0 lg:pb-0"
      >
        {SECTIONS.map((section) => {
          const current = section.id === active;
          const badge = badges[section.id as keyof typeof badges];

          return (
            <Link
              key={section.id}
              href={`/${locale}/account${section.path}`}
              aria-current={current ? 'page' : undefined}
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm whitespace-nowrap transition-colors lg:min-h-0 lg:w-full lg:py-2 ${
                current
                  ? 'bg-gold/12 font-bold text-gold'
                  : 'text-muted hover:bg-line/40 hover:text-text'
              }`}
            >
              {/* The key is a lookup, so it is not a literal next-intl can check. */}
              {dynamicMessage(t, LABEL_KEY[section.id], section.id)}
              {/*
                `dir="ltr"`: a badge is a number, sometimes a currency amount, on a line that may be
                Arabic. `ms-auto` pushes it to the far side in either direction.
              */}
              {badge ? (
                <span
                  dir="ltr"
                  className="ms-auto rounded-full bg-sky/15 px-2 py-0.5 text-[11px] font-bold text-sky"
                >
                  {badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/*
        A `div`, not a second `<main>`.

        `app/[locale]/layout.tsx` already wraps every page in `<main id="main">` — the target its skip
        link points at — so a `<main>` here produced two nested main landmarks on every account page.
        That is invalid HTML and it makes a screen reader's landmark list ambiguous: "main" twice, with
        no way to tell which one holds the section. Found by a browser probe that could not resolve
        `locator('main')` to one element.
      */}
      <div className="min-w-0 lg:col-start-2 lg:row-start-1">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="font-display text-3xl font-bold text-gold">{title}</h1>
          <span className="print:hidden">
            <SignOutButton locale={locale} />
          </span>
        </div>

        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

/**
 * A section with no data source yet.
 *
 * Rendered instead of an empty list, and the distinction matters: an empty «المفضلة» says "you have
 * saved nothing", which is a different and false statement from "this is not built". The console
 * makes the same call for its eleven unbuilt sections.
 */
export async function AccountNotBuilt({ reason }: { readonly reason: string }) {
  const t = await getTranslations('account');

  return (
    <section className="rounded-card border border-dashed border-gold/35 bg-card p-6">
      <h2 className="font-display text-lg text-warn">{t('notBuiltHeading')}</h2>
      <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-text">{reason}</p>
    </section>
  );
}
