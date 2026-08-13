import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@/i18n/routing';
import { getSession } from '@/lib/session-server';
import { ORNAMENT_BRAND } from '@safra/ui';

/**
 * Site header, following the prototype's layout.
 *
 * Positioning uses logical properties throughout (`start`/`end`, `ms`/`me`), so the
 * whole bar mirrors correctly under RTL without a second stylesheet or any
 * direction-specific overrides.
 */
export async function SiteHeader({ locale }: { locale: Locale }) {
  const t = await getTranslations('nav');
  const brand = await getTranslations('brand');
  const auth = await getTranslations('auth');

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
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur-sm print:hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <Link href={`/${locale}`} className="flex items-center gap-3 me-auto">
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

        {/*
          Visible at EVERY width. It was `hidden … sm:flex`, which took the site's two primary
          destinations away from every phone with nothing in their place — a visitor could reach
          الإقامات only by editing the URL. The header already wraps, and two links need no drawer.
        */}
        <nav aria-label={t('home')} className="flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-10 items-center rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-card hover:text-gold"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/*
          The language switcher MOVED TO THE FOOTER (Bashar, 2026-08-13), which is where the
          reference design puts it and where people look for it.

          What had to survive the move is the reason it was links rather than a menu: a crawler
          follows them, and that is how the alternate-language version of a city page gets indexed
          (§5.4). The footer's are still real anchors, and they are better than these were — they
          keep the reader's PAGE instead of sending everyone to the home page. `generateMetadata`
          emits the `hreflang` alternates either way.
        */}

        {/*
          Account or sign in. The email is shown rather than a name because that is
          what the API's auth payload carries — inventing a display name from it
          would just be guessing at what comes before the @.
        */}
        {session ? (
          <Link
            href={`/${locale}/account`}
            className="inline-flex min-h-10 max-w-[10rem] items-center truncate rounded-lg border border-gold/40 bg-card px-3 py-1.5 text-xs text-gold transition-colors hover:border-gold"
            title={session.user.email}
          >
            {auth('account')}
          </Link>
        ) : (
          <Link
            href={`/${locale}/login`}
            className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-gold/50 hover:text-gold"
          >
            {auth('signIn')}
          </Link>
        )}
      </div>
    </header>
  );
}
