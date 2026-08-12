'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { ThemeToggle } from '@safra/ui';

/**
 * The site header's theme toggle — absent on حسابي.
 *
 * Bashar, 2026-08-12: the customer dashboard should carry the toggle beside sign out, the way لوحة
 * الشريك does. That is a MOVE, not a copy: two controls for one setting on the same screen is worse
 * than either arrangement, so on account pages the header gives its toggle up and the sidebar foot
 * has it instead.
 *
 * The header keeps it everywhere else, because the public site has no sidebar to put it in — which is
 * the whole reason this app ever had it up here and the staff portals never did.
 *
 * ## Why the path is read here rather than passed in
 *
 * `SiteHeader` is a server component rendered by the locale layout, and a layout does not know which
 * route is beneath it. `usePathname` is the only thing that does, and it needs a client component.
 */
export function HeaderThemeToggle() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  /*
    `/ar/account`, `/en/account/wallet`, … — the second segment, compared rather than pattern-matched,
    so `/en/accounts-payable` could never be mistaken for it.
  */
  if (pathname.split('/')[2] === 'account') return null;

  return (
    <ThemeToggle
      toLightLabel={t('themeToLight')}
      toDarkLabel={t('themeToDark')}
      whenUnset="system"
    />
  );
}
