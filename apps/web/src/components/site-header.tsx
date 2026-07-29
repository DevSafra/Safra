import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { LOCALE_LABELS, type Locale, routing } from '@/i18n/routing';
import { ThemeToggle } from './theme-toggle';

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

  const links = [
    { href: `/${locale}`, label: t('home') },
    { href: `/${locale}/search`, label: t('stays') },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <Link href={`/${locale}`} className="flex items-center gap-3 me-auto">
          <span
            aria-hidden
            className="grid size-10 place-items-center rounded-xl border border-gold/40 bg-card text-lg text-gold"
          >
            ۞
          </span>
          <span className="leading-tight">
            <span className="block font-display text-lg font-bold text-gold">
              {brand('name')} <span className="text-text/70">|</span> {brand('latin')}
            </span>
            <span className="block text-xs text-faint">{brand('tagline')}</span>
          </span>
        </Link>

        <nav aria-label={t('home')} className="hidden items-center gap-1 sm:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-card hover:text-gold"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/*
          Language switcher as real links, not a JS dropdown: crawlers follow them,
          which is how the alternate-language versions of a city page get indexed.
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
                  ? 'rounded-lg border border-gold/50 bg-card px-2.5 py-1.5 text-xs text-gold'
                  : 'rounded-lg border border-transparent px-2.5 py-1.5 text-xs text-faint transition-colors hover:text-gold'
              }
            >
              {LOCALE_LABELS[code]}
            </Link>
          ))}
        </nav>

        <ThemeToggle />
      </div>
    </header>
  );
}
