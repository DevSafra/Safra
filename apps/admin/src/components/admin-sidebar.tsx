'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ARABIC_WESTERN_DIGITS } from '@/lib/numerals';
import { t } from '@/lib/strings';

/**
 * One entry in the command-center sidebar.
 *
 * `href` is optional on purpose. The approved design lists eighteen sections; seven are
 * built. The rest are rendered — because the design is the agreed shape of the console
 * and hiding them would misrepresent how much remains — but they are NOT links. A nav
 * item that navigates to a 404 is worse than one that visibly does not navigate yet.
 */
interface NavItem {
  readonly key: keyof typeof t.nav;
  readonly href?: string;
  /** Which counter, if any, drives the badge. */
  readonly badge?: 'bookings' | 'partners' | 'properties' | 'staff';
  /**
   * Renders the badge red instead of blue (`badgeWarn` in the design handoff §8).
   *
   * Set for the queues where a non-zero count means someone is WAITING on SAFRA — a partner
   * who cannot trade until verified, a customer whose dispute is open. A count of bookings
   * or staff is information; these are a backlog, and the colour is the difference.
   */
  readonly warn?: true;
}

/**
 * The eighteen sections from the approved design (SAFRA 29.07), in its order.
 *
 * The order is the design's, not alphabetical and not built-first: staff learn a spatial
 * habit for where things sit, and reordering as sections ship would break it every time.
 */
const NAV: readonly NavItem[] = [
  { key: 'dashboard', href: '/' },
  { key: 'bookings', href: '/bookings', badge: 'bookings' },
  { key: 'partners', href: '/partners', badge: 'partners', warn: true },
  { key: 'properties', href: '/properties', badge: 'properties', warn: true },
  { key: 'customers', href: '/customers' },
  { key: 'staff', href: '/staff', badge: 'staff' },
  { key: 'payments', href: '/payments' },
  { key: 'wallet', href: '/wallet' },
  { key: 'giftCards', href: '/giftcards' },
  { key: 'coupons', href: '/coupons' },
  /*
    The last four have routes but no data behind them. They link to a page that NAMES what is
    missing, which is better than both alternatives: a dead nav item tells the operator nothing,
    and an empty table tells them something false.
  */
  { key: 'ads', href: '/ads' },
  { key: 'disputes', href: '/disputes', warn: true },
  { key: 'messages', href: '/messages' },
  { key: 'whatsapp', href: '/comms' },
  { key: 'geo', href: '/geo' },
  { key: 'reports', href: '/reports' },
  { key: 'settings', href: '/settings' },
  { key: 'audit', href: '/audit' },
];

export interface SidebarCounts {
  readonly bookings?: number | undefined;
  readonly partners?: number | undefined;
  readonly properties?: number | undefined;
  readonly staff?: number | undefined;
}

export function AdminSidebar({ counts }: { counts: SidebarCounts }) {
  const pathname = usePathname();

  // 14px radius and 14px padding — the handoff's sidebar values (§9.5, §9.6).
  return (
    <aside className="sticky top-6 rounded-[14px] border border-[rgba(var(--goldA),0.14)] bg-card p-3.5">
      <p className="px-2.5 py-1 text-[11px] font-bold tracking-[0.1em] text-faint">
        {t.nav.heading}
      </p>

      <nav className="mt-1 grid gap-0.5">
        {NAV.map((item) => {
          const label = t.nav[item.key];
          const badge = item.badge ? counts[item.badge] : undefined;

          /**
           * Active when the path matches, but the dashboard's `/` only when exact —
           * otherwise it would highlight alongside every other section.
           */
          const active =
            item.href === '/'
              ? pathname === '/'
              : item.href !== undefined && pathname.startsWith(item.href);

          const row = (
            <>
              <span>{label}</span>
              {badge !== undefined && badge > 0 ? (
                /*
                  Blue by default, red when the count is a backlog (§8). Gold is reserved
                  for the active section and for affirmative accents, so a gold badge here
                  would compete with the selection state on every row at once.
                */
                <span
                  className={`rounded-full px-2 py-px text-[10px] font-extrabold ${
                    item.warn
                      ? 'bg-[rgba(var(--badA),0.18)] text-bad'
                      : 'bg-[rgba(var(--skyA),0.15)] text-sky'
                  }`}
                >
                  {badge.toLocaleString(ARABIC_WESTERN_DIGITS)}
                </span>
              ) : null}
            </>
          );

          // 8px radius on nav items (§9.5).
          const shared =
            'flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px]';

          if (!item.href) {
            /**
             * Not yet built. Dimmed and given a tooltip rather than removed, and
             * `aria-disabled` so a screen reader announces it as unavailable instead of
             * reading a link that goes nowhere.
             */
            return (
              <span
                key={item.key}
                aria-disabled="true"
                title={t.nav.notBuilt}
                className={`${shared} cursor-not-allowed text-faint2`}
              >
                {row}
              </span>
            );
          }

          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`${shared} transition-colors ${
                active
                  ? 'bg-[rgba(var(--goldA),0.12)] font-bold text-gold'
                  : 'text-muted hover:bg-line2 hover:text-text'
              }`}
            >
              {row}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
