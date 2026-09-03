import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@/i18n/routing';
import { getSession } from '@/lib/session-server';
import { getCurrencyCatalogue } from '@/lib/catalog';
import { DISPLAY_CURRENCIES, displayCurrency } from '@/lib/currency';
import { HeaderMenus } from '@/components/header-menus';
import { HeaderNav } from '@/components/header-nav';
import { HeaderShell } from '@/components/header-shell';
import { ORNAMENT_BRAND } from '@safra/ui';

/**
 * Site header.
 *
 * Positioning uses logical properties throughout (`start`/`end`, `ms`/`me`), so the
 * whole bar mirrors correctly under RTL without a second stylesheet or any
 * direction-specific overrides.
 *
 * ## No background until the page moves (Bashar, 2026-09-02)
 *
 * «On the top it should have no background same as booking.com and on scrolling, it should.» The
 * surface lives in `HeaderShell`, which is the only client code here — see the note there on why
 * that is an IntersectionObserver and not a scroll listener. The bar is also taller than it was,
 * 80px against 66px, which is what gives the wordmark and the two new controls room to sit on one
 * line without the bar feeling packed.
 *
 * **Consequence, accepted:** with no background at the top, the header's contents sit on whatever
 * is behind them — the hero's pale wash on the home page, the page ground everywhere else. Both
 * were measured rather than assumed; the gold wordmark against the hero is the tightest pair on
 * the bar and it is why the wordmark is `text-xl` and not smaller.
 *
 * ## The band follows the THEME (Bashar, 2026-09-02: «the navbar colour should be also light»)
 *
 * It was pinned to the night palette in both themes by `.brand-band`, so a visitor who chose the
 * light theme still met a dark bar across the top of every page. It is now an ordinary surface —
 * `bg-card` with a hairline under it — which resolves to white on a light page and to the
 * prototype's dark card on a dark one. `.brand-band` was used by nothing else and is gone.
 *
 * **The filled action is `.btn-gold`** — the prototype's gradient, which Bashar screenshotted on
 * 2026-09-02. It was briefly `sky`, because gold ROUTED THROUGH THE TOKEN fails on white: the
 * light theme's #a87a1f under near-white text is 3.56:1. `.btn-gold` carries its own foreground
 * and background instead of taking either from the palette, so the pair measures 6.1:1 at the
 * gradient's dark end in both themes and the primary action looks the same wherever it appears.
 *
 * **The outlined action keeps the page's text colour with a gold border.** Gold TEXT on the white
 * card is 3.87:1, under the floor for a 14px control, and a second filled gold button beside the
 * first would give the header two primaries. Near-black on white is 15.7:1, and the border is
 * what ties it to its neighbour.
 *
 * **The wordmark is `text-xl`, not `text-lg`.** Gold on white is 3.87:1, which is AA for large
 * text and not for small: at 18px bold it is 13.5pt, just under the 14pt bold threshold, and at
 * 20px bold it is over it. One step of type size is what makes the brand legal to draw in its
 * own colour.
 *
 * **One control height across the bar** (Bashar, 2026-09-02: «the menu items on the navbar is a
 * little bit under the logo»). Every item was `min-h-10` while the brand mark is 44px, so with the
 * row centred the brand's box began 2px above everything else's — measured, brand at y=20 and the
 * menu at y=22. The TEXT baselines were already identical to a tenth of a pixel; it was the BOXES
 * that differed, which is the half nobody thinks to check. From `sm` every control is 44px, so the
 * row has one top edge and one bottom edge.
 *
 * **Hover is a gold WASH, never gold text** (Bashar, 2026-09-02: «I see a blue background»). Every
 * hover in here was `bg-field` under `text-sky` — a cool grey pill under #2e66a8 type, which was
 * the only blue anywhere on the header and belonged to nothing. Gold TEXT cannot replace it: at
 * 14px on the white card it is 3.55:1, under the floor, which is what put sky there in the first
 * place.
 *
 * So the brand colour arrives as a 10% wash with the text at full contrast instead — the same
 * `bg-gold/10` the property badges already use, so this is the page's existing idiom rather than a
 * new one. All three controls share it, because a header with one hover for its links and another
 * for its buttons reads as two headers.
 *
 * Three things borrowed from booking.com, deliberately:
 *
 * - **Two account actions, not one.** «إنشاء حساب» outlined and «تسجيل الدخول» filled, which is
 *   booking.com's Register/Sign in pair. The old header offered only sign-in, so a visitor with no
 *   account had nothing to press.
 * - **«سجّل كشريك» in the header**, which is booking.com's «List your property». The recruitment
 *   panel was at the very bottom of the home page and nowhere else on the site.
 * - **Navigation as pills**, sized to the 40px touch floor rather than as bare text links.
 *
 * **Not borrowed: the second tab row.** booking.com carries five product verticals (stays, flights,
 * cars…) and needs a row for them. SAFRA has one vertical and two destinations; a second row for
 * two links is height spent on nothing, and it would push the search bar off a phone's first
 * screen.
 *
 * **The current page IS marked** (Bashar, 2026-09-03), by `HeaderNav` — the one client component
 * this bar needs for it. The note here used to say two links were not worth that; the design marks
 * the current item in gold, so they are.
 */
export async function SiteHeader({ locale }: { locale: Locale }) {
  const t = await getTranslations('nav');
  const brand = await getTranslations('brand');
  const auth = await getTranslations('auth');
  const home = await getTranslations('home');

  /**
   * Reading the session makes every page dynamic, which is the cost of a header
   * that knows who you are. It is paid only where it must be: the city and property
   * pages that §5.4 needs indexed render their own content statically, and this
   * header is the sole dynamic part of them.
   */
  /*
    Three reads in parallel, and two of them are free: `getCurrencyCatalogue` is the same
    five-minute cached read the footer already makes and Next deduplicates it within a request, and
    `displayCurrency` reads a cookie — which this header is already dynamic for, because of the
    session below.
  */
  const [session, { currencies }, currency] = await Promise.all([
    getSession(),
    getCurrencyCatalogue(),
    displayCurrency(),
  ]);

  /*
    The list is `DISPLAY_CURRENCIES`; the catalogue supplies only the SYMBOL. This is the footer's
    own arrangement and the reason is a defect this popup had for one build: offering the catalogue
    directly listed TRY, which is a currency listings are PRICED in and not one prices can be shown
    in. `isDisplayCurrency` rejects it on the way back, so choosing it set nothing and silently
    left the reader on the default — a control that looks like it works and does not.

    Mapping over the constant fixes the order as well: USD, EUR, SYP, rather than whatever
    alphabetical order the reference table happens to return.
  */
  const symbolOf = (code: string) =>
    currencies.find((one) => one.code === code)?.symbol ?? code;

  const displayCurrencies = DISPLAY_CURRENCIES.map((code) => ({
    code,
    symbol: symbolOf(code),
  }));

  const links = [
    { href: `/${locale}`, label: t('home') },
    { href: `/${locale}/search`, label: t('stays') },
  ];

  return (
    <HeaderShell>
      {/*
        `gap-x-5` from `lg`, which is the prototype's own header (`gap:20px`), and 12px below it.
        Not taste: at 768 the five visible items come to 654px inside a 736px bar, so 20px gaps
        plus the nav's start margin put it 10px over and dropped «تسجيل الدخول» onto a second row.
        The desktop bar is where the design's figure was measured and where there is room for it.
      */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:py-4 lg:h-[var(--header-h)] lg:gap-x-5 lg:py-0">
        {/*
          The wordmark alone. The tagline «إقامات في الوطن العربي · من ليلة واحدة» sat under it and
          is gone (Bashar, 2026-09-02) — booking.com's header carries none, it cost a second line
          exactly where the bar is tightest, and it still reads in the footer, which is the one
          place a strapline belongs.
        */}
        <Link href={`/${locale}`} className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-card border border-gold/40 text-lg text-gold sm:size-11 sm:text-xl"
          >
            {ORNAMENT_BRAND}
          </span>
          {/*
            The Latin half goes below `sm`. «سفرة | SAFRA» is three words wide on a bar that had
            already wrapped to three rows once the language and currency controls arrived — 161px
            of a 390px phone, measured. «سفرة» alone is still the brand.
          */}
          <span className="font-display text-xl font-bold text-gold">
            {brand('name')}
            <span className="hidden sm:inline">
              {' '}
              <span className="text-text/50">|</span> {brand('latin')}
            </span>
          </span>
        </Link>

        {/*
          Visible at EVERY width. It was `hidden … sm:flex`, which took the site's two primary
          destinations away from every phone with nothing in their place — a visitor could reach
          الإقامات only by editing the URL. The header already wraps, and two links need no drawer.
        */}
        {/*
          Beside the wordmark, at the reading START — the right of an Arabic page (Bashar,
          2026-09-02: «the navbar menu on the right side»). The auto margin used to sit on the
          brand, which pushed the navigation the whole width of the bar and left it floating
          against the account buttons; it sits on the NAV now, so brand and menu read as one group
          and everything after it is pushed to the far end. `me-*` rather than `mr-*`, so the
          English and German pages get the mirror of this rather than a copy of it.
        */}
        <HeaderNav links={links} label={t('home')} />

        {/*
          booking.com's «List your property», in the place booking.com puts it. Reuses the home
          page's approved wording rather than inventing a header-specific string: «سجّل كشريك» is
          the same offer, and a second phrase for it would be a third thing to translate.

          Hidden below `lg`, which is where booking.com drops its own «List your property» — it is
          the first thing they give up and the last thing they add back, because a partner signing
          a property up is not doing it from a handset between trains.

          Measured, not guessed: at 768px the six items came to ~735px inside a 736px bar, so the
          row wrapped and «تسجيل الدخول» fell to a second line 44px below the rest. Dropping this
          one link is 98px back and the bar closes to a single row at 768 and 1024 alike.

          **Typed as a nav item, because it is one** (Bashar, 2026-09-03: it «should have the same
          font weight as the menu items»). 13.5px/600 in `--muted` — the same three values
          `HeaderNav` uses, and the same ones the prototype gives every button in its own nav,
          «لوحة الشريك» included. It was 14px/400 in `--text/85`, which is a different size, a
          different weight AND a different colour from the two links it sits beside.
        */}
        <Link
          href={`/${locale}/partners/join`}
          className="hidden min-h-10 items-center rounded-lg px-3 py-2 text-[13.5px] font-semibold text-muted transition-colors hover:bg-gold/10 hover:text-text sm:min-h-11 lg:inline-flex"
        >
          {home('partnersCta')}
        </Link>

        {/*
          Account, or the Register/Sign in pair.

          The email is not shown: it is what the API's auth payload carries, and inventing a display
          name from it would be guessing at what comes before the @. It stays in `title`.
        */}
        {/*
          Language and currency, as booking.com puts them: in the bar, the language as its flag,
          each opening a popup. They are ALSO still in the footer, which is where Bashar moved them
          on 2026-08-13 and where people look for them on a long page — the header is the reach
          from anywhere, the footer is the reach at the end. Removing one was not asked for.
        */}
        <HeaderMenus
          locale={locale}
          currency={currency}
          currencies={displayCurrencies}
          labels={{
            language: t('language'),
            currency: t('currency'),
            chooseLanguage: t('chooseLanguage'),
            chooseCurrency: t('chooseCurrency'),
            currencyHelp: t('currencyHelp'),
            close: t('closeDialog'),
          }}
        />

        {session ? (
          <Link
            href={`/${locale}/account`}
            className="inline-flex min-h-10 max-w-[10rem] btn-gold items-center truncate rounded-lg px-4 py-2 text-sm font-bold transition-opacity hover:opacity-90 sm:min-h-11"
            title={session.user.email}
          >
            {auth('account')}
          </Link>
        ) : (
          <>
            <Link
              href={`/${locale}/register`}
              className="inline-flex min-h-10 items-center rounded-lg border border-gold/60 px-4 py-2 text-sm font-semibold text-text transition-colors hover:border-gold hover:bg-gold/10 sm:min-h-11"
            >
              {auth('createAccount')}
            </Link>
            <Link
              href={`/${locale}/login`}
              className="inline-flex min-h-10 btn-gold items-center rounded-lg px-4 py-2 text-sm font-bold transition-opacity hover:opacity-90 sm:min-h-11"
            >
              {auth('signIn')}
            </Link>
          </>
        )}
      </div>
    </HeaderShell>
  );
}
