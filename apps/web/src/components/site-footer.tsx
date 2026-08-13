import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { LOCALE_LABELS, type Locale, routing } from '@/i18n/routing';
import { ORNAMENT_BRAND } from '@safra/ui';

/**
 * The site footer, on every page of the customer site and nowhere else.
 *
 * ## Why it lives in the locale layout
 *
 * The staff console and the partner portal are separate applications with their own layouts, so
 * "everywhere except the two dashboards" needs no exclusion list — putting this in
 * `app/[locale]/layout.tsx` reaches exactly the customer site and cannot leak into either. An
 * exclusion list would have been a thing to keep in step with every new route.
 *
 * ## EVERY LINK HERE RESOLVES, and that constraint shaped the contents
 *
 * A footer conventionally carries About, Contact, Terms, Privacy, Careers and a partner signup.
 * **None of those pages exist**, and `O-web-2` is already an open item about two links on the home
 * and property pages that 404 — a call to action that dead-ends is a broken promise, and adding six
 * more would be repeating a known mistake at the bottom of every page instead of on two of them.
 *
 * So this links only to what is built: the two public destinations, the account screens (which
 * redirect an anonymous visitor to sign in, which is the correct answer rather than a dead end),
 * and the three locales. **The absence of Terms and Privacy is recorded in `docs/FUTURE-WORK.md`**
 * rather than papered over with links to nothing.
 *
 * ## The language links are the SEO half
 *
 * Real anchors with `hrefLang`, not a JavaScript switcher, for the same reason the header's are:
 * a crawler follows them, and that is how the alternate-language version of a city page gets
 * indexed (§5.4). Having them in the footer as well as the header is deliberate — the header's set
 * is small and easy to miss on a phone, and this is the conventional place to look for them.
 *
 * ## No data is fetched
 *
 * Deliberately. This renders on every page of the site, so a query here — the served cities, say,
 * which would be genuinely useful — would be one extra round trip on every single page view,
 * including the property and city pages §5.4 needs fast. A footer is not worth that.
 *
 * `print:hidden`, like the header: an invoice printed from الفواتير should be the invoice.
 */
export async function SiteFooter({ locale }: { locale: Locale }) {
  const t = await getTranslations('footer');
  const nav = await getTranslations('nav');
  const brand = await getTranslations('brand');
  const account = await getTranslations('account');

  const explore = [
    { href: `/${locale}`, label: nav('home') },
    { href: `/${locale}/search`, label: nav('stays') },
  ];

  /*
    Auth-gated, and that is fine: an anonymous visitor following one lands on sign-in with their
    destination remembered, which is behaviour the account area already has. A footer that hid
    these until somebody signed in would be a footer that changes shape depending on who is
    looking, for no benefit.
  */
  const mine = [
    { href: `/${locale}/account`, label: account('navOverview') },
    { href: `/${locale}/account/bookings`, label: account('navBookings') },
    { href: `/${locale}/account/favourites`, label: account('navFavourites') },
    { href: `/${locale}/account/support`, label: account('navSupport') },
  ];

  return (
    <footer className="mt-16 border-t border-line bg-card/40 print:hidden">
      <div className="mx-auto max-w-6xl px-4 py-10">
        {/*
          One column on a phone, two on a tablet, four from `lg`. The brand block spans two at every
          width above one, because its paragraph needs the measure — squeezed into a quarter it
          wraps to eight lines and reads as a mistake.
        */}
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Link href={`/${locale}`} className="inline-flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-10 place-items-center rounded-xl border border-gold/40 bg-card text-lg text-gold"
              >
                {ORNAMENT_BRAND}
              </span>
              <span className="leading-tight">
                <span className="block font-display text-lg font-bold text-gold">
                  {brand('name')} <span className="text-text/70">|</span> {brand('latin')}
                </span>
                <span className="block text-xs text-faint">{brand('tagline')}</span>
              </span>
            </Link>

            <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted">
              {t('about')}
            </p>
          </div>

          <FooterNav title={t('explore')} links={explore} />
          <FooterNav title={t('account')} links={mine} />
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4 border-t border-line pt-6">
          {/*
            The locales, as real links. `aria-current` rather than a disabled control: the one you
            are on is still a valid destination, it is simply where you already are.
          */}
          <nav aria-label={t('language')} className="flex items-center gap-1">
            {routing.locales.map((code) => (
              <Link
                key={code}
                href={`/${code}`}
                hrefLang={code}
                aria-current={code === locale ? 'true' : undefined}
                className={
                  code === locale
                    ? 'inline-flex min-h-10 items-center rounded-lg border border-gold/50 bg-card px-2.5 py-1.5 text-xs text-gold lg:min-h-0'
                    : 'inline-flex min-h-10 items-center rounded-lg border border-transparent px-2.5 py-1.5 text-xs text-faint transition-colors hover:text-gold lg:min-h-0'
                }
              >
                {LOCALE_LABELS[code]}
              </Link>
            ))}
          </nav>

          <p className="text-xs text-faint">{t('madeFor')}</p>

          {/*
            `ms-auto` — a LOGICAL margin, so the copyright sits at the trailing edge in both
            directions. `ml-auto` would pin it to the left of an Arabic page, which is the start.

            The year comes from the clock rather than from a catalogue string: a hardcoded one is
            wrong every January, and it is the kind of wrong nobody notices for months. Every page
            here is already dynamic — the header reads the session — so this is not baked at build.
          */}
          <p className="text-xs text-faint sm:ms-auto">
            {t('rights', { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}

/** One titled column of links. Two today; a third would be one more call, not one more shape. */
function FooterNav({
  title,
  links,
}: {
  readonly title: string;
  readonly links: readonly { readonly href: string; readonly label: string }[];
}) {
  return (
    <nav aria-label={title}>
      <h2 className="text-xs font-bold tracking-wide text-text uppercase">{title}</h2>
      <ul className="mt-3 grid gap-1">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              /*
                `min-h-10` below `lg`, where the input is a finger — and `inline-flex`, because
                `min-height` does nothing to an inline element. A list of links at 13px is exactly
                the control that fails a touch target audit.
              */
              className="inline-flex min-h-10 items-center text-sm text-muted transition-colors hover:text-gold lg:min-h-0 lg:py-0.5"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
