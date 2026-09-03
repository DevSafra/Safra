import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@/i18n/routing';
import { HeaderMenus } from '@/components/header-menus';
import { getCities, getCurrencyCatalogue } from '@/lib/catalog';
import { DISPLAY_CURRENCIES, displayCurrency } from '@/lib/currency';
import { localisedName } from '@/lib/localise';
import { CUSTOMER_FACING_METHODS } from '@safra/contracts';
import { ORNAMENT_BRAND } from '@safra/ui';

/**
 * The site footer, on every page of the customer site and nowhere else.
 *
 * ## Why it lives in the locale layout
 *
 * The staff console and the partner portal are separate applications with their own layouts, so
 * "everywhere except the two dashboards" needs no exclusion list — putting this in
 * `app/[locale]/layout.tsx` reaches exactly the customer site and cannot leak into either.
 *
 * ## The shape is the reference Bashar gave (2026-09-03)
 *
 * A band, a brand block at the reading start, then narrow link columns, then a rule and the
 * copyright centred beneath it.
 *
 * **The band follows the THEME** (Bashar, 2026-09-03: «change the footer background color to light
 * when the current theme is light»). It was briefly dark in both, and that was a special case with
 * its own palette; it is now plain `bg-footer` and plain theme tokens, which is what every other
 * surface in this app uses. The handoff already specifies both — `--footerBg` is `#EDEFF6` light
 * and `#0A0817` dark — so following the theme is also following the design, and the eight-variable
 * override that existed to force one of them is gone rather than left switched off.
 *
 * **What the reference has and this does not**, listed rather than faked: a telephone number, a
 * street address, three social accounts and two app-store badges. SAFRA has no published phone, no
 * registered address in any catalogue, no social accounts and no mobile app. Inventing any of them
 * would put a fabricated business record at the bottom of every page — the exact failure
 * `O-web-2`/`O-web-5` already track for links that resolve to nothing. The blocks appear the moment
 * there are real values to put in them.
 *
 * ## EVERY LINK HERE RESOLVES, and that constraint shaped the contents
 *
 * The reference carries About, Careers, Press and eleven legal pages; ours holds what is built. The
 * cities column is the one place that grew: `/city/[slug]` pages are real, `getCities()` is already
 * cached, and a footer that links them is what §5.4 asks for — internal links a crawler can follow
 * to the pages that should rank.
 *
 * ## The two controls at the foot
 *
 * Language moved here out of the navbar (Bashar, 2026-08-13) and both stay here now, said again
 * with the reference («the change language and currency buttons do not remove them»). Both are
 * `<details>` rather than JavaScript menus: they open with no script, they survive a failed
 * hydration, and the language options stay real anchors — which is what lets a crawler follow them
 * and index the alternate-language version of a city page (§5.4).
 *
 * ## It no longer reads a request header
 *
 * The old currency form POSTed a `next` path, so this had to know where the reader was — and the
 * only way a server component can is `x-safra-pathname`, set by the middleware, ABSENT on any path
 * containing a dot, and therefore validated here before it could be reflected into a link.
 * `HeaderMenus` asks the browser with `usePathname()` instead, so the header, the validation and
 * the `headers()` call are all gone rather than left in place unused.
 *
 * ## Two fetches, both cached
 *
 * `getCurrencyCatalogue` and `getCities` are the shared five-minute cached reads the price and city
 * surfaces already make, and they run concurrently. A footer on every page must not add a round
 * trip of its own; these add none.
 */
export async function SiteFooter({ locale }: { locale: Locale }) {
  const t = await getTranslations('footer');
  const brand = await getTranslations('brand');
  const account = await getTranslations('account');
  const nav = await getTranslations('nav');
  const auth = await getTranslations('auth');
  const payment = await getTranslations('paymentMethods');

  const [{ currencies }, cities, chosen] = await Promise.all([
    getCurrencyCatalogue(),
    getCities(),
    displayCurrency(),
  ]);

  /*
    `DISPLAY_CURRENCIES` for the list, the catalogue for the SYMBOL — the header's own arrangement,
    and the reason is a defect this popup had for one build: offering the catalogue directly listed
    TRY, a currency listings are PRICED in and not one prices can be SHOWN in, so choosing it set
    nothing and left the reader on the default.
  */
  const symbolOf = (code: string) =>
    currencies.find((entry) => entry.code === code)?.symbol ?? code;

  const displayCurrencies = DISPLAY_CURRENCIES.map((code) => ({
    code,
    symbol: symbolOf(code),
  }));

  const destinations = {
    title: t('links'),
    links: [
      { href: `/${locale}`, label: nav('home') },
      { href: `/${locale}/search`, label: nav('stays') },
      /*
          «انضم كشريك» sits with the destinations rather than under الدعم, where it went when تصفّح
          was removed (Bashar, 2026-09-03). The reference puts «للمضيفين» last in its own links
          column, and it is an invitation to use the site rather than a way to get help with it.
        */
      { href: `/${locale}/partners/join`, label: t('becomePartner') },
      /*
          A PUBLIC route, and the only one in this footer that a signed-out visitor needs more than
          a signed-in one: somebody who booked as a guest and lost the reference has no account to
          look in. `auth.findTitle` is the page's own heading, so the link and its destination
          cannot drift apart.
        */
      { href: `/${locale}/find-booking`, label: auth('findTitle') },
    ],
  };

  /*
    Auth-gated, and that is fine: an anonymous visitor following one lands on sign-in with their
    destination remembered, which the account area already does. A footer that changed shape
    depending on who is looking would buy nothing.
  */
  const accountLinks = {
    title: t('account'),
    links: [
      { href: `/${locale}/account`, label: account('navOverview') },
      { href: `/${locale}/account/bookings`, label: account('navBookings') },
      { href: `/${locale}/account/favourites`, label: account('navFavourites') },
      { href: `/${locale}/account/invoices`, label: account('navInvoices') },
      { href: `/${locale}/account/wallet`, label: account('navWallet') },
      { href: `/${locale}/account/gifts`, label: account('navGifts') },
      { href: `/${locale}/account/reviews`, label: account('navReviews') },
      { href: `/${locale}/account/profile`, label: account('navProfile') },
    ],
  };

  /*
    Six, and only ones with something to show.

    A city with no published property renders a page that says so, which is a fine destination from
    المدن on the home page — the reader clicked it — and a poor one from a link repeated on every
    page of the site. Six is the reference's column depth; beyond that the footer starts competing
    with the page above it.
  */
  const linkedCities = cities.filter((city) => city.propertyCount > 0).slice(0, 6);

  return (
    <footer className="mt-16 bg-footer print:hidden">
      <div className="mx-auto max-w-7xl px-4 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-12 lg:gap-8">
          {/*
            The brand block, and the widest column — four of twelve, which is the proportion the
            reference gives it. It carries what the reference's brand block carries: the mark, a
            sentence saying what this is, and the utility controls underneath.
          */}
          <div className="lg:col-span-4">
            <Link href={`/${locale}`} className="inline-flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-11 place-items-center rounded-card border border-gold/40 bg-card text-xl text-gold"
              >
                {ORNAMENT_BRAND}
              </span>
              <span className="leading-tight">
                <span className="block font-display text-xl font-bold text-gold">
                  {brand('name')} <span className="text-text2/60">|</span>{' '}
                  {brand('latin')}
                </span>
                <span className="block text-[0.85rem] text-muted">
                  {brand('tagline')}
                </span>
              </span>
            </Link>

            <p className="mt-5 max-w-prose text-[0.85rem] leading-relaxed text-muted">
              {t('about')}
            </p>

            {/*
              Said once, here, rather than beside every converted price: a browse price is an
              estimate and the amount somebody is charged is the listing's own. Repeating it under
              each card would be noise; omitting it entirely would leave the estimate looking like a
              quote.
            */}
            <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted">
              {t('currencyNote')}
            </p>

            {/*
              The payment methods SAFRA offers (Bashar, 2026-09-03, with the reference).

              **`CUSTOMER_FACING_METHODS`, and that is a decision rather than a shortcut.** This was
              first built to ask `availablePaymentMethods` what routing can serve today, because
              `property.ts` argues — correctly, for CHECKOUT — that printing the approved list would
              show a Klarna button before Klarna is contracted. Driven that way the strip rendered
              nothing at all, since routing currently points at `manual_transfer`. Bashar was told
              why and asked for the four anyway; the list is his (approved 2026-07-30) and what
              SAFRA states it accepts is a business claim, not an engineering one.

              The distinction that makes this safe is that the strip is INFORMATIONAL. Nobody is
              stranded mid-payment by a footer: checkout still offers only what routing can actually
              serve, and that is still asked of the API on the page where it decides something.

              No fetch, so the footer costs nothing extra on every page of the site — which the
              per-country version did.
            */}
            <ul
              aria-label={payment('heading')}
              className="mt-5 flex flex-wrap items-center gap-2"
            >
              {CUSTOMER_FACING_METHODS.map((method) => (
                <li
                  key={method}
                  className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs font-medium text-text2"
                >
                  {payment(method)}
                </li>
              ))}
            </ul>

            {/*
              The SAME control as the navbar, opening the same popup (Bashar, 2026-09-03).

              It was a pair of `<details>` menus with their own look and their own panels, so the
              site had two answers to «change my language» that behaved differently on the same
              page. `HeaderMenus` is one answer, and being one component is most of the point.

              Two things were given up, both weighed rather than overlooked:

              - **The no-script fallback.** A `<details>` opens without JavaScript; a `useState`
                modal does not. The header already had that limitation, so this makes the site
                consistent rather than newly dependent — and the language links inside the popup are
                still real anchors, so following one needs no script either.
              - **Crawlable hreflang anchors.** The old note here said those anchors were what got
                the alternate-language pages indexed (§5.4). They are not: `alternates.languages` in
                the layout emits `<link rel="alternate" hreflang>` into every page's head, which is
                the mechanism crawlers actually read. Verified in the served HTML before removing
                them, not assumed.
            */}
            <div className="mt-6">
              <HeaderMenus
                locale={locale}
                currency={chosen}
                currencies={displayCurrencies}
                labels={{
                  language: nav('language'),
                  currency: nav('currency'),
                  chooseLanguage: nav('chooseLanguage'),
                  chooseCurrency: nav('chooseCurrency'),
                  currencyHelp: nav('currencyHelp'),
                  close: nav('closeDialog'),
                }}
              />
            </div>
          </div>

          <nav aria-label={destinations.title} className="lg:col-span-2">
            <FooterHeading>{destinations.title}</FooterHeading>
            <FooterList>
              {destinations.links.map((link) => (
                <FooterLink key={link.href} href={link.href}>
                  {link.label}
                </FooterLink>
              ))}
            </FooterList>
          </nav>

          {/* Only when there is something to link — never an empty heading. */}
          {linkedCities.length > 0 ? (
            <nav aria-label={t('cities')} className="lg:col-span-2">
              <FooterHeading>{t('cities')}</FooterHeading>
              <FooterList>
                {linkedCities.map((city) => (
                  <FooterLink key={city.slug} href={`/${locale}/city/${city.slug}`}>
                    {localisedName(city, locale)}
                  </FooterLink>
                ))}
              </FooterList>
            </nav>
          ) : null}

          {/*
            Two headings in one column, which is what the reference does with الشركة over قانوني.
            They are separate `nav` landmarks rather than one list under a merged title: «الدعم»
            and «قانوني» are different promises, and a screen reader reading the landmarks gets both
            rather than a heading that covers neither.
          */}
          <div className="lg:col-span-2">
            <nav aria-label={t('support')}>
              <FooterHeading>{t('support')}</FooterHeading>
              <FooterList>
                <FooterLink href={`/${locale}/account/support`}>
                  {account('navSupport')}
                </FooterLink>
                <FooterLink href={`/${locale}/account/disputes`}>
                  {account('navDisputes')}
                </FooterLink>
              </FooterList>
            </nav>

            <nav aria-label={t('legal')} className="mt-7">
              <FooterHeading>{t('legal')}</FooterHeading>
              <FooterList>
                {/*
                  `O-web-5` recorded the absence of these rather than filling it with links to
                  nothing — every link here resolves, and until 2026-08-14 neither page existed.
                  They do now, and they say plainly which parts still need legal copy rather than
                  pretending to be finished.
                */}
                <FooterLink href={`/${locale}/terms`}>{t('terms')}</FooterLink>
                <FooterLink href={`/${locale}/privacy`}>{t('privacy')}</FooterLink>
              </FooterList>
            </nav>
          </div>

          {/*
            LAST, and that is a composition decision rather than an ordering accident: it is eight
            links where every other column is two to six, and the reference's own silhouette puts
            its tallest column at the far end. In the middle it made the row look ragged — a long
            column with short ones on both sides reads as a mistake rather than as a list.
          */}
          <nav aria-label={accountLinks.title} className="lg:col-span-2">
            <FooterHeading>{accountLinks.title}</FooterHeading>
            <FooterList>
              {accountLinks.links.map((link) => (
                <FooterLink key={link.href} href={link.href}>
                  {link.label}
                </FooterLink>
              ))}
            </FooterList>
          </nav>
        </div>

        {/*
          The rule and the centred copyright, as the reference closes. Centred rather than pushed to
          the edges, which is what it was: at 1280px an `ms-auto` copyright and a start-aligned
          strapline read as two unrelated lines on one row, and the reference's own answer — both
          centred, stacked, quiet — is better because neither is asking to be read.
        */}
        <div className="mt-12 border-t border-line pt-7 text-center">
          <p className="text-[0.85rem] text-text2">
            {t('rights', { year: new Date().getFullYear() })}
          </p>
          <p className="mt-1.5 text-xs text-muted">{t('madeFor')}</p>
        </div>
      </div>
    </footer>
  );
}

/* ── The column parts ─────────────────────────────────────────────────────── */

/**
 * A column heading.
 *
 * `h2` because these are the footer's own sections and there is exactly one `h1` above them, and
 * the reference's weight — bold, at body size — because a footer heading that whispers makes the
 * reader work out which links belong together.
 */
function FooterHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[0.85rem] font-bold text-text">{children}</h2>;
}

function FooterList({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3.5 grid gap-0.5">{children}</ul>;
}

/**
 * One link.
 *
 * `min-h-10` below `lg`, where the input is a finger — and `inline-flex`, because `min-height` does
 * nothing to an inline element. Colour rather than underline on hover: a column of eight links that
 * all underline on the way past is noisier than one that brightens.
 */
function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="inline-flex min-h-10 items-center text-[0.85rem] text-muted transition-colors duration-200 ease-out-strong hover:text-gold lg:min-h-0 lg:py-1"
      >
        {children}
      </Link>
    </li>
  );
}
