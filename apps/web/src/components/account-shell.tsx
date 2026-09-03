import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { SidebarBackdrop, SidebarToggle, ThemeToggle } from '@safra/ui';

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

/**
 * The id the hamburger points at with `aria-controls`.
 *
 * A constant rather than a literal in two files: `SidebarToggle` moves focus into the element with this
 * id when it opens the drawer, so a typo makes the control silently stop working for a keyboard user.
 */
const ACCOUNT_SIDEBAR_ID = 'account-sidebar';

export type AccountSection =
  | 'overview'
  | 'bookings'
  | 'wallet'
  | 'gifts'
  | 'favourites'
  | 'reviews'
  | 'invoices'
  | 'support'
  | 'disputes'
  | 'profile';

/**
 * The sidebar order.
 *
 * §6 lists الملف الشخصي last; Bashar moved it directly under نظرة عامة (2026-08-12). This array is the
 * only place the order is stated — the nav renders it and the badge lookup keys off the ids — so a
 * change here moves the item and nothing else has to agree with it.
 *
 * The deviation from the handoff is deliberate and recorded here rather than left to look like a
 * mistake: profile is where somebody goes to fix their details, which has more in common with the
 * overview than with the four registries of things they have done.
 */
const SECTIONS: readonly { readonly id: AccountSection; readonly path: string }[] = [
  { id: 'overview', path: '' },
  { id: 'profile', path: '/profile' },
  { id: 'bookings', path: '/bookings' },
  { id: 'wallet', path: '/wallet' },
  { id: 'gifts', path: '/gifts' },
  { id: 'favourites', path: '/favourites' },
  { id: 'reviews', path: '/reviews' },
  { id: 'invoices', path: '/invoices' },
  { id: 'support', path: '/support' },
  /*
    النزاعات last, and directly after الدعم on purpose: a dispute is the escalation of a support
    request, so the order on the page is the order a person moves through them.
  */
  { id: 'disputes', path: '/disputes' },
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
  support: 'navSupport',
  disputes: 'navDisputes',
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
  /* The theme labels live in `nav`, shared with the header that used to carry this control. */
  const tn = await getTranslations('nav');
  /* The footer owns this label — one word for one destination, wherever it is offered. */
  const tf = await getTranslations('footer');

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
    <div className="account-layout mx-auto max-w-6xl px-4 py-10">
      {/* Print geometry lives with the layout in `globals.css`, not as `print:` utilities here. */}
      {/*
        Content BEFORE navigation in the DOM, with the sidebar placed back into column one by
        `globals.css` from `lg` up — exactly what لوحة الشريك and the console do.

        This replaced a nav that came first and turned into a horizontally scrolling tab strip below
        `lg`. Bashar, 2026-08-11: the customer sidebar should match the other two dashboards. The strip
        was defensible on its own terms, but three dashboards with three different navigations is the
        thing a person notices, and now one set of controls in `@safra/ui` drives all three.
      */}
      <div className="account-main min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/*
            First in the row, so it is the first thing tab reaches and the first thing a thumb finds.
            Available at EVERY width — the reader chooses whether the sidebar is there on a phone and on
            a desktop alike, which is the standing instruction the staff apps already follow.
          */}
          <span className="print:hidden">
            <SidebarToggle
              sidebarId={ACCOUNT_SIDEBAR_ID}
              showLabel={t('navShowSidebar')}
              hideLabel={t('navHideSidebar')}
            />
          </span>

          <h1 className="font-display text-3xl font-bold text-gold">{title}</h1>
        </div>

        <div className="mt-8">{children}</div>
      </div>

      {/*
        Second in the DOM, first in the desktop grid.

        `tabIndex={-1}` makes it focusable by SCRIPT but not by tab, so opening the drawer can move
        focus into it without adding a stop to the desktop tab order where it is only a column. The
        `aria-label` is on the aside rather than the nav, because the aside is what the hamburger
        controls and what focus lands on — labelling both would announce the same words twice.
      */}
      <aside
        id={ACCOUNT_SIDEBAR_ID}
        tabIndex={-1}
        aria-label={t('navHeading')}
        className="account-sidebar flex flex-col rounded-card border border-line bg-card p-3.5 print:hidden"
      >
        {/*
          The NAV scrolls, not the aside.

          `min-h-0` is load-bearing: a flex item defaults to `min-height: auto` and refuses to shrink
          below its content, so on a short screen the rows would push sign-out past the bottom of the
          drawer. `content-start` is the other half — `flex-1` makes the nav fill the drawer, and a grid
          with free space distributes it across its rows, which turned the partner portal's four items
          into four 180px slabs. Eight rows here would do the same.
        */}
        <nav className="grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto">
          {SECTIONS.map((section) => {
            const current = section.id === active;
            const badge = badges[section.id as keyof typeof badges];

            return (
              <Link
                key={section.id}
                href={`/${locale}/account${section.path}`}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm transition-colors lg:min-h-0 lg:py-2 ${
                  current
                    ? 'bg-gold/12 font-bold text-gold-ink'
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

          {/*
            «انضم كشريك», at the foot of the nav and OUTSIDE `SECTIONS` (Bashar, 2026-08-19).

            Not a section: every other row is a record of this customer's own — their bookings,
            their wallet — and this one leaves the account area entirely for a public page. Kept in
            the list because the customer dashboard is where somebody who already uses SAFRA
            discovers they can list a place, and a footer link is not where they would look.

            Separated by a rule and given no `aria-current`, so it never reads as the section you
            are in.
          */}
          <Link
            href={`/${locale}/partners/join`}
            className="mt-2 inline-flex min-h-10 items-center border-t border-line px-3 pt-3 text-sm text-muted transition-colors hover:bg-line/40 hover:text-gold lg:min-h-0 lg:py-2"
          >
            {tf('becomePartner')}
          </Link>
        </nav>

        {/*
          The account controls at the FOOT of the sidebar — theme and sign out, exactly as لوحة الشريك
          and the console arrange them (Bashar, 2026-08-12).

          `mt-auto` pins the row to the bottom of the DRAWER, which is full height, while on a desktop
          the aside is only as tall as its content so it sits immediately under the last nav row. One
          rule, both shapes, because the aside is a flex column.

          This is now the ONLY theme control in the customer app: Bashar had it removed from the navbar
          (2026-08-12). A visitor who has not signed in therefore gets no manual switch, and the page
          they get is LIGHT — the customer CSS has no `prefers-color-scheme` rule any more, so nothing
          follows the OS. The block below carries the consequence for this toggle.
        */}
        {/*
          The theme toggle lives HERE and in the two staff sidebars — the three dashboards — and
          nowhere else (Bashar, 2026-08-13).

          It briefly moved to the site footer, beside language and currency, on the reading that all
          three are "how this site is presented to me". That was wrong: theme is a control for
          somebody working in a dashboard, not part of the public site's chrome, and the public
          default is simply white.

          `whenUnset="light"` because the customer CSS no longer consults `prefers-color-scheme` —
          with no explicit choice the page IS light, so the icon must offer dark. Passing `'system'`
          here would show a crescent on a light page for anyone whose OS prefers dark.
        */}
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <ThemeToggle
            surface="web"
            toLightLabel={tn('themeToLight')}
            toDarkLabel={tn('themeToDark')}
            whenUnset="light"
          />

          {/* `flex-1` so it takes the rest of the row beside the 40px toggle, as the partner's does. */}
          <div className="min-w-0 flex-1">
            <SignOutButton locale={locale} />
          </div>
        </div>
      </aside>

      {/* Dismisses the drawer on a tap; `SidebarToggle` handles Escape and focus return. */}
      <SidebarBackdrop label={t('navHideSidebar')} className="account-backdrop" />
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
