'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ThemeToggle } from '@safra/ui';
import { SEEN_BADGE_CAP, seenBadgeLabel } from '@safra/contracts';
import { Ltr } from '@/components/admin-table';

import { ARABIC_WESTERN_DIGITS } from '@/lib/numerals';
import { SignOutButton } from '@/components/sign-out-button';
import { SIDEBAR_ID, t } from '@/lib/strings';

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
  readonly badge?:
    | 'bookings'
    | 'partners'
    | 'properties'
    | 'staff'
    | 'partnerApplications'
    | 'disputes'
    | 'customers'
    | 'payments'
    | 'wallet'
    | 'messages';
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
 * The sections, in the approved design's order (SAFRA 29.07) — eighteen of them, plus one.
 *
 * The order is the design's, not alphabetical and not built-first: staff learn a spatial
 * habit for where things sit, and reordering as sections ship would break it every time.
 */
/**
 * The badges whose count has no natural bound, and which therefore cap.
 *
 * Everything else counts a queue that empties — bookings awaiting confirmation, partners pending
 * verification — where the exact figure is both cheap and the point.
 */
const UNBOUNDED_BADGES: ReadonlySet<string> = new Set([
  'customers',
  'payments',
  'wallet',
]);

const NAV: readonly NavItem[] = [
  { key: 'dashboard', href: '/' },
  { key: 'bookings', href: '/bookings', badge: 'bookings' },
  { key: 'partners', href: '/partners', badge: 'partners', warn: true },
  /*
    NINETEEN, and this is the one the approved design does not have (Bashar, 2026-08-19).

    «انضم كشريك» gave the platform a queue it never had: people asking to join, before they are
    partners. It sits directly under الشركاء because that is who works it and what a request
    becomes, and it carries a badge because a request nobody looks at is a business SAFRA loses.
  */
  {
    key: 'partnerApplications',
    href: '/applications',
    badge: 'partnerApplications',
    warn: true,
  },
  { key: 'properties', href: '/properties', badge: 'properties', warn: true },
  /*
    ── «new since I last looked» (Bashar, 2026-08-27) ──────────────────────────

    Not `warn`. That flag is for a queue where somebody is WAITING on SAFRA — an unverified partner
    cannot trade, an open dispute holds money. A customer who signed up is not waiting on anybody:
    this badge says «there are rows here you have not seen», and blue is what that reads as.
  */
  { key: 'customers', href: '/customers', badge: 'customers' },
  { key: 'staff', href: '/staff', badge: 'staff' },
  /*
    أدوار الموظفين, directly after الموظفون.

    The pair belongs together: one screen invites the person, the other defines what the job they
    are given can do. Partners' employee roles are a DIFFERENT screen on the partner dashboard,
    because each side defines the roles of its own employees (Bashar, 2026-08-23).
  */
  { key: 'staffRoles', href: '/staff-roles' },
  { key: 'payments', href: '/payments', badge: 'payments' },
  { key: 'wallet', href: '/wallet', badge: 'wallet' },
  { key: 'giftCards', href: '/giftcards' },
  { key: 'coupons', href: '/coupons' },
  /*
    All eighteen are built. This list is the whole console, not a built-first subset.

    It carried a note until 2026-08-13 saying the last four were routes with no data behind them,
    and that had been untrue for some time: every section below queries its own registry, pages it
    and paints its statuses like the ones above. A stale comment about what is MISSING is the worst
    kind, because the next person reads it as a backlog and plans work that is already done.
  */
  { key: 'ads', href: '/ads' },
  /*
    The badge Bashar asked for on 2026-08-27, and `warn` was already set for it — the note on that
    flag names «a customer whose dispute is open» as the case it exists for, and the count had
    simply never been produced.
  */
  { key: 'disputes', href: '/disputes', badge: 'disputes', warn: true },
  /*
    `warn`, because somebody is WAITING. A thread with something unread is a person who has written
    to SAFRA and not been answered — which is what that flag's own note describes, and the same
    reading as an unverified partner or an untaken dispute.
  */
  { key: 'messages', href: '/messages', badge: 'messages', warn: true },
  { key: 'whatsapp', href: '/comms' },
  { key: 'geo', href: '/geo' },
  /* Directly under المدن، because a category is a property OF a city (Bashar, 2026-08-30). */
  { key: 'cityCategories', href: '/city-categories' },
  { key: 'catalogue', href: '/catalogue' },
  { key: 'treasury', href: '/treasury' },
  { key: 'reports', href: '/reports' },
  { key: 'settings', href: '/settings' },
  { key: 'audit', href: '/audit' },
  /*
    وضع الطوارئ in the nav, added 2026-08-24, and it is a REACHABILITY fix rather than a promotion.

    It was reachable from one place: a red link in the dashboard's header, deliberately not in the
    sidebar so it could not be opened by a mis-click. That held while every reader landed on the
    dashboard. Gating changed it — a reader holding `emergency_mode.activate` and not
    `booking.read_all` is now redirected off the dashboard before that header renders, so the
    control became reachable only by typing the URL, for exactly the role most likely to need it
    in a crisis. Found by project-e9 checking my inferred reason against the actual link.

    The mis-click argument does not survive the nav being permission-filtered: the only readers who
    see this entry are the ones who hold the capability, and they are the ones meant to have it.
    The dashboard link stays — two ways to reach the one control that matters under pressure is the
    correct number.
  */
  { key: 'emergency', href: '/emergency', warn: true },
];

/**
 * Every badge the sidebar can draw — and every key is REQUIRED.
 *
 * ## Why required, when most of them are `undefined` in practice
 *
 * Two places build this: `sidebarCounts()` for the eighteen sections that go through
 * `ConsoleShell`, and the dashboard, which renders the sidebar itself from its own payload. They
 * are the same list of badges assembled twice, and on 2026-08-20 the dashboard's copy was missing
 * `partnerApplications` — so طلبات الشراكة showed its number on every screen except the one a
 * super admin opens first. Nothing failed: the key was optional, so leaving it out was legal.
 *
 * Optional keys make "I have no number for this" and "I forgot this exists" the same expression.
 * Required ones force the choice to be made — the same reasoning `Field` uses for `dir` — so
 * adding a badge to `NAV` breaks every builder until each has said what it wants there.
 *
 * `undefined` remains a legitimate answer, and `NO_COUNTS` below is the shorthand for "none of
 * them", which is what a failed counter fetch means.
 */
export interface SidebarCounts {
  readonly bookings: number | undefined;
  readonly partners: number | undefined;
  readonly properties: number | undefined;
  readonly staff: number | undefined;
  readonly partnerApplications: number | undefined;
  readonly disputes: number | undefined;
  readonly customers: number | undefined;
  readonly payments: number | undefined;
  readonly wallet: number | undefined;
  readonly messages: number | undefined;
}

/**
 * No badges at all.
 *
 * A counter fetch that fails must not take a screen down with it — a missing badge is a cosmetic
 * loss and the section below it is what the reader came for. Named rather than written as an
 * object literal at each call site, because the whole point of the required keys above is that
 * writing this out by hand is where one gets dropped.
 */
export const NO_COUNTS: SidebarCounts = {
  bookings: undefined,
  partners: undefined,
  properties: undefined,
  staff: undefined,
  partnerApplications: undefined,
  disputes: undefined,
  customers: undefined,
  payments: undefined,
  wallet: undefined,
  messages: undefined,
};

export function AdminSidebar({
  counts,
  sections,
}: {
  counts: SidebarCounts;
  /**
   * The sections this reader may open, resolved SERVER-SIDE and passed in.
   *
   * This component is `'use client'`, so it cannot read the session itself — and it should not.
   * `ConsoleShell` calls `readerSections()` and hands the answer down, which keeps one answer to
   * "what may this person open" rather than a second one computed in the browser.
   *
   * Filtering here is not an access control and must not be mistaken for one: the API refuses
   * every section on its own authority, and each page carries its own guard for a reader who
   * arrives by URL. This stops somebody being offered nineteen links that answer «انتهت الجلسة».
   */
  sections: readonly string[];
}) {
  const pathname = usePathname();
  const openable = new Set(sections);

  // 14px radius and 14px padding — the handoff's sidebar values (§9.5, §9.6).
  return (
    /*
      Second in the DOM, first in the desktop grid — `console-sidebar` places it back in column 1
      from `lg` up. Rendered before `main`, its nineteen links pushed every section below the fold
      on a phone, so the console opened on a list of links rather than on what you navigated to.

      `tabIndex={-1}` makes it focusable by SCRIPT but not by tab, so opening the drawer can move
      focus into it without adding a stop to the desktop tab order where it is just a column.
      Positioning, stickiness and the three visibility states are all in `globals.css`: they depend
      on an attribute on `<html>` and must be right in the first painted frame.
    */
    <aside
      id={SIDEBAR_ID}
      tabIndex={-1}
      aria-label={t.nav.heading}
      className="console-sidebar flex flex-col rounded-card border border-[rgba(var(--goldA),0.14)] bg-card p-3.5"
    >
      <p className="px-2.5 py-1 text-[11px] font-bold tracking-[0.1em] text-faint">
        {t.nav.heading}
      </p>

      {/*
        The NAV scrolls, not the whole sidebar.
        
        `min-h-0` is the load-bearing half: a flex item defaults to `min-height: auto` and refuses
        to shrink below its content, so without it nineteen rows push the footer past the bottom of
        the drawer and sign-out sits below the scroll. With it the nav takes the leftover space and
        scrolls inside itself, and the controls stay visible.
      */}
      <nav className="mt-1 grid min-h-0 flex-1 gap-0.5 overflow-y-auto">
        {/*
          Filtered, not disabled. A greyed-out link is a map of what somebody may not do, and this
          console hands that map to whoever is reading — which is reconnaissance for anyone
          deciding which account to go after. A section a reader cannot open is simply not there.
        */}
        {NAV.filter((item) => openable.has(item.key)).map((item) => {
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
                  {/*
                    ── only the UNBOUNDED badges are capped ────────────────────

                    «New since I last looked» has no natural bound, so its query stops reading at
                    the cap and the badge must not print a figure that stopped counting — the same
                    rule the tables follow for «أكثر من ١٠٠٠٠ نتيجة».

                    The other badges are bounded QUEUES and their counts are exact. Capping them
                    too was the first version of this, and it turned «١٠٢٦ حجزاً بانتظار تأكيد
                    الشريك» into «+99» — an operational number replaced by a shrug. Caught by
                    looking at the screen.

                    `Ltr` because «99+» is a Latin run on an Arabic line: without it the bidi
                    algorithm moves the plus to the wrong end and it reads «+99». The plain counts
                    need no isolation — a bare number has no directional character in it.
                  */}
                  {UNBOUNDED_BADGES.has(item.badge ?? '') && badge > SEEN_BADGE_CAP ? (
                    <Ltr>{seenBadgeLabel(badge)}</Ltr>
                  ) : (
                    badge.toLocaleString(ARABIC_WESTERN_DIGITS)
                  )}
                </span>
              ) : null}
            </>
          );

          // 8px radius on nav items (§9.5).
          const shared =
            'flex min-h-10 items-center justify-between rounded-lg px-2.5 py-2 text-[13px]';

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

      {/*
        The account controls, at the foot of the sidebar (Bashar, 2026-08-05).
        
        They were in the page header, where on a phone they wrapped onto a second row under the
        title — 390px cannot hold a hamburger, a 28px title, the date and role, a theme toggle and
        a sign-out button on one line, and the wrap read as two headers rather than one.
        
        `mt-auto` pins them to the bottom of the DRAWER, which is full height, while on a desktop
        the aside is only as tall as its content so they sit immediately under the nav. One rule,
        both shapes, because the aside is a flex column.
      */}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line2 pt-3">
        {/*
          `whenUnset='dark'` — the console is designed dark and its CSS has no
          `prefers-color-scheme` rule, so dark is what is actually on screen before anyone chooses.
        */}
        <ThemeToggle
          surface="admin"
          toLightLabel={t.dashboard.themeToLight}
          toDarkLabel={t.dashboard.themeToDark}
          whenUnset="dark"
        />
        <SignOutButton />
      </div>
    </aside>
  );
}
