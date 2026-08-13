import Link from 'next/link';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';

import { LOCALE_LABELS, type Locale, routing } from '@/i18n/routing';
import { getCurrencyCatalogue } from '@/lib/catalog';
import { DISPLAY_CURRENCIES, displayCurrency } from '@/lib/currency';
import { swapLocale } from '@/lib/locale-path';
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
 * ## EVERY LINK HERE RESOLVES, and that constraint shaped the contents
 *
 * The reference design (Booking.com) carries About, Careers, Press, partner signup and eleven legal
 * pages. **None of ours exist.** `O-web-2` is already an open item about two links that 404, and
 * `O-web-5` records the two that genuinely matter — Terms and Privacy — as needing legal copy that
 * is not mine to draft. Adding them here as dead links would repeat a known mistake at the bottom
 * of every page rather than on two of them.
 *
 * So the columns hold what is built. They are thinner than the reference and they are honest.
 *
 * ## The two controls at the foot
 *
 * Language moved here out of the navbar (Bashar, 2026-08-13), which is where the reference design
 * puts it and where people look for it. Both are `<details>` rather than JavaScript menus: they
 * open with no script, they survive a failed hydration, and the language options stay real anchors
 * — which is what lets a crawler follow them and index the alternate-language version of a city
 * page (§5.4). That property was the header switcher's whole justification and it is not lost by
 * moving.
 *
 * The language links now keep the reader's PAGE, which the header's never did — see `swapLocale`.
 *
 * ## One fetch, cached
 *
 * `getCurrencyCatalogue` is the only read here and it is the shared five-minute cached one that the
 * price surfaces already make. A footer on every page must not add a round trip of its own.
 */
export async function SiteFooter({ locale }: { locale: Locale }) {
  const t = await getTranslations('footer');
  const nav = await getTranslations('nav');
  const brand = await getTranslations('brand');
  const account = await getTranslations('account');

  const [{ currencies }, chosen, requestHeaders] = await Promise.all([
    getCurrencyCatalogue(),
    displayCurrency(),
    headers(),
  ]);

  /*
    Set by the middleware, because a server component cannot ask Next for the pathname. The fallback
    is the locale root — a switcher that loses the page is worse than the header's was, but a
    switcher that throws is worse than both.
  */
  const pathname = requestHeaders.get('x-safra-pathname') ?? `/${locale}`;

  const symbolOf = (code: string) =>
    currencies.find((currency) => currency.code === code)?.symbol ?? code;

  const groups = [
    {
      title: t('explore'),
      links: [
        { href: `/${locale}`, label: nav('home') },
        { href: `/${locale}/search`, label: nav('stays') },
      ],
    },
    {
      /*
        Auth-gated, and that is fine: an anonymous visitor following one lands on sign-in with their
        destination remembered, which the account area already does. A footer that changed shape
        depending on who is looking would buy nothing.
      */
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
    },
    {
      title: t('support'),
      links: [
        { href: `/${locale}/account/support`, label: account('navSupport') },
        { href: `/${locale}/account/disputes`, label: account('navDisputes') },
      ],
    },
  ];

  return (
    <footer className="mt-16 border-t border-line bg-card/40 print:hidden">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="text-sm font-bold text-text">{group.title}</h2>
              <ul className="mt-3 grid gap-0.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      /*
                        `min-h-10` below `lg`, where the input is a finger — and `inline-flex`,
                        because `min-height` does nothing to an inline element.
                      */
                      className="inline-flex min-h-10 items-center text-sm text-muted transition-colors hover:text-gold lg:min-h-0 lg:py-1"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 border-t border-line pt-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link href={`/${locale}`} className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-10 place-items-center rounded-xl border border-gold/40 bg-card text-lg text-gold"
              >
                {ORNAMENT_BRAND}
              </span>
              <span className="leading-tight">
                <span className="block font-display text-base font-bold text-gold">
                  {brand('name')} <span className="text-text/70">|</span> {brand('latin')}
                </span>
                <span className="block text-xs text-faint">{brand('tagline')}</span>
              </span>
            </Link>

            <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
              <LanguagePicker
                locale={locale}
                pathname={pathname}
                label={t('language')}
                help={t('languageApply')}
              />
              <CurrencyPicker
                locale={locale}
                pathname={pathname}
                chosen={chosen}
                symbolOf={symbolOf}
                label={t('currency')}
                help={t('currencyApply')}
              />
            </div>
          </div>

          <p className="mt-5 max-w-prose text-xs leading-relaxed text-faint">
            {t('about')}
          </p>

          {/*
            Said once, here, rather than beside every converted price: a browse price is an estimate
            and the amount somebody is charged is the listing's own. Repeating it under each card
            would be noise; omitting it entirely would leave the estimate looking like a quote.
          */}
          <p className="mt-2 max-w-prose text-xs leading-relaxed text-faint">
            {t('currencyNote')}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="text-xs text-faint">{t('madeFor')}</p>
            {/*
              `ms-auto` — a LOGICAL margin, so the copyright sits at the trailing edge in both
              directions. `ml-auto` would pin it to the left of an Arabic page, which is the start.
            */}
            <p className="text-xs text-faint sm:ms-auto">
              {t('rights', { year: new Date().getFullYear() })}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * The language control: one compact summary, three real anchors inside it.
 *
 * `<details>` because it needs no JavaScript and degrades to an always-readable list if CSS fails.
 * The options are anchors rather than form buttons for the reason the header's were: a crawler
 * follows them, and that is how the alternate-language version of a page gets indexed.
 */
function LanguagePicker({
  locale,
  pathname,
  label,
  help,
}: {
  readonly locale: Locale;
  readonly pathname: string;
  readonly label: string;
  readonly help: string;
}) {
  return (
    /*
      `name` makes the two pickers an exclusive group — opening one closes the other, with no
      script. Without it both can be open at once, and on a phone the panels overlap because they
      both open upward from the same row.

      A browser that does not know the attribute simply allows both, which is what happened before
      and is a cosmetic overlap rather than a broken control.
    */
    <details name="footer-picker" className="relative">
      <summary
        aria-label={label}
        className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm text-text2 transition-colors hover:border-gold/50 hover:text-gold"
      >
        <span aria-hidden>🌐</span>
        {LOCALE_LABELS[locale]}
      </summary>

      {/*
        `w-max`, not `min-w-*`. An absolutely positioned box shrinks to fit its CONTAINING BLOCK —
        here the `<details>`, which is as wide as the little summary — so a minimum width let the
        panel be narrower than its own help line and clip it («اعرض الموقع بهذه الل»). `max-w` keeps
        the content-sized box from running off a phone.

        `bottom-full` — it opens UPWARD. A menu at the very foot of the page that opened downward
        would render below the viewport, and the reader would have to scroll to a place the page
        does not go.
      */}
      <ul className="absolute bottom-full start-0 z-20 mb-2 w-max max-w-[min(16rem,80vw)] rounded-lg border border-line bg-card p-1 shadow-lg">
        <li className="px-2 py-1 text-[11px] leading-snug text-faint">{help}</li>
        {routing.locales.map((code) => (
          <li key={code}>
            <Link
              href={swapLocale(pathname, code)}
              hrefLang={code}
              aria-current={code === locale ? 'true' : undefined}
              className={`flex min-h-10 items-center rounded-md px-2 text-sm transition-colors lg:min-h-9 ${
                code === locale
                  ? 'bg-field font-semibold text-gold'
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

/**
 * The currency control: a POST per option, because choosing one WRITES a cookie.
 *
 * Buttons rather than links, deliberately. A `<Link>` that set a preference would fire on Next's
 * prefetch — which happens on hover, and for links in the viewport, on render — so a reader who
 * merely opened this menu would have their currency changed for them. The same reasoning made the
 * console's rows-per-page bar a POST.
 *
 * `next` carries the current path so the reader stays where they are; the route handler validates
 * it as same-origin rather than trusting it.
 */
function CurrencyPicker({
  locale,
  pathname,
  chosen,
  symbolOf,
  label,
  help,
}: {
  readonly locale: Locale;
  readonly pathname: string;
  readonly chosen: string;
  readonly symbolOf: (code: string) => string;
  readonly label: string;
  readonly help: string;
}) {
  return (
    /*
      `name` makes the two pickers an exclusive group — opening one closes the other, with no
      script. Without it both can be open at once, and on a phone the panels overlap because they
      both open upward from the same row.

      A browser that does not know the attribute simply allows both, which is what happened before
      and is a cosmetic overlap rather than a broken control.
    */
    <details name="footer-picker" className="relative">
      <summary
        aria-label={label}
        className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm text-text2 transition-colors hover:border-gold/50 hover:text-gold"
      >
        <span aria-hidden>{symbolOf(chosen)}</span>
        {chosen}
      </summary>

      <form
        action={`/${locale}/currency`}
        method="post"
        className="absolute bottom-full start-0 z-20 mb-2 w-max max-w-[min(16rem,80vw)] rounded-lg border border-line bg-card p-1 shadow-lg"
      >
        <input type="hidden" name="next" value={pathname} />
        <p className="px-2 py-1 text-[11px] leading-snug text-faint">{help}</p>

        {DISPLAY_CURRENCIES.map((code) => (
          <button
            key={code}
            type="submit"
            name="currency"
            value={code}
            aria-current={code === chosen ? 'true' : undefined}
            className={`flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-start text-sm transition-colors lg:min-h-9 ${
              code === chosen
                ? 'bg-field font-semibold text-gold'
                : 'text-muted hover:bg-field hover:text-gold'
            }`}
          >
            <span aria-hidden className="w-5">
              {symbolOf(code)}
            </span>
            {code}
          </button>
        ))}
      </form>
    </details>
  );
}
