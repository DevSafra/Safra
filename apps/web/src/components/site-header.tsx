import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@/i18n/routing';
import { getSession } from '@/lib/session-server';
import { ORNAMENT_BRAND } from '@safra/ui';

/**
 * Site header.
 *
 * Positioning uses logical properties throughout (`start`/`end`, `ms`/`me`), so the
 * whole bar mirrors correctly under RTL without a second stylesheet or any
 * direction-specific overrides.
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
 * **No active-page state on the pills.** A Server Component cannot read the pathname, and marking
 * the current tab the way booking.com does would mean either a client component in the header of
 * every route or a pathname header set in middleware. Neither is worth it for two links; recorded
 * rather than silently dropped.
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
  const session = await getSession();

  const links = [
    { href: `/${locale}`, label: t('home') },
    { href: `/${locale}/search`, label: t('stays') },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-card print:hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5">
        {/*
          The wordmark alone. The tagline «إقامات في الوطن العربي · من ليلة واحدة» sat under it and
          is gone (Bashar, 2026-09-02) — booking.com's header carries none, it cost a second line
          exactly where the bar is tightest, and it still reads in the footer, which is the one
          place a strapline belongs.
        */}
        <Link href={`/${locale}`} className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 place-items-center rounded-xl border border-gold/40 text-lg text-gold"
          >
            {ORNAMENT_BRAND}
          </span>
          <span className="font-display text-xl font-bold text-gold">
            {brand('name')} <span className="text-text/50">|</span> {brand('latin')}
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
        <nav aria-label={t('home')} className="me-auto flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-10 items-center rounded-lg px-3 py-2 text-sm text-text/85 transition-colors hover:bg-gold/10 hover:text-text"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/*
          booking.com's «List your property», in the place booking.com puts it. Reuses the home
          page's approved wording rather than inventing a header-specific string: «سجّل كشريك» is
          the same offer, and a second phrase for it would be a third thing to translate.

          Hidden below `sm` — on a phone the band has room for the brand, the two destinations and
          the account action, and this is the one of the four a visitor is least likely to want
          from a handset.
        */}
        <Link
          href={`/${locale}/partners/join`}
          className="hidden min-h-10 items-center rounded-lg px-3 py-2 text-sm text-text/85 transition-colors hover:bg-gold/10 hover:text-text sm:inline-flex"
        >
          {home('partnersCta')}
        </Link>

        {/*
          Account, or the Register/Sign in pair.

          The email is not shown: it is what the API's auth payload carries, and inventing a display
          name from it would be guessing at what comes before the @. It stays in `title`.
        */}
        {session ? (
          <Link
            href={`/${locale}/account`}
            className="inline-flex min-h-10 max-w-[10rem] btn-gold items-center truncate rounded-lg px-4 py-2 text-sm font-bold transition-opacity hover:opacity-90"
            title={session.user.email}
          >
            {auth('account')}
          </Link>
        ) : (
          <>
            <Link
              href={`/${locale}/register`}
              className="inline-flex min-h-10 items-center rounded-lg border border-gold/60 px-4 py-2 text-sm font-semibold text-text transition-colors hover:border-gold hover:bg-gold/10"
            >
              {auth('createAccount')}
            </Link>
            <Link
              href={`/${locale}/login`}
              className="inline-flex min-h-10 btn-gold items-center rounded-lg px-4 py-2 text-sm font-bold transition-opacity hover:opacity-90"
            >
              {auth('signIn')}
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
