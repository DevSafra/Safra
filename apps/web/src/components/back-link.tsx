import { getTranslations } from 'next-intl/server';

import { BackNavigation } from '@/components/back-navigation';
import { backArrow } from '@/lib/arrows';
import type { Locale } from '@/i18n/routing';

/**
 * «رجوع» — the back control on a detail screen.
 *
 * The customer app's twin of the console's `BackLink`, and it borrows two decisions from it.
 *
 * **The arrow is its own flex item.** Left inside the text run, the bidi algorithm decides where it
 * lands and puts it on the wrong side of the label on an RTL line. As a sibling it is placed by the
 * layout instead, which is deterministic.
 *
 * **The glyph follows the reading direction.** Back means "the way I came", which on an RTL page is
 * rightward and on an LTR page leftward — the opposite of a date range, and the same convention the
 * partner portal already uses for its previous-month arrow.
 */
export async function BackLink({
  href,
  locale,
}: {
  readonly href: string;
  readonly locale: Locale;
}) {
  const t = await getTranslations('common');
  const arrow = backArrow(locale);

  return (
    /*
      `BackNavigation` rather than `Link`: on an ordinary click it returns to the page the reader
      actually came from, and falls back to this `href` when there is nothing of ours behind them —
      a directly-opened page, a new tab, or JavaScript switched off. Bashar, 2026-08-24: the control
      must "navigate really back to the previous opened page".
    */
    <BackNavigation
      href={href}
      className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg border border-line px-4 text-sm text-muted transition-colors hover:border-gold hover:text-gold lg:min-h-0 lg:py-2"
    >
      <span aria-hidden="true">{arrow}</span>
      {t('back')}
    </BackNavigation>
  );
}
