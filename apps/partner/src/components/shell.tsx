import Link from 'next/link';

import { SidebarBackdrop, SidebarToggle, ThemeToggle } from '@safra/ui';

import { SIDEBAR_ID, t } from '@/lib/strings';

/**
 * The two-column shell from the design handoff §7: a 220px sidebar and the section beside it.
 *
 * ## Content before navigation
 *
 * The `<main>` comes FIRST in the DOM and is placed into column one by `globals.css`, exactly as
 * the console does. On a phone the layout collapses to one column, and a partner opening their
 * dashboard should land on their listings rather than on a list of four nav links.
 *
 * ## The sidebar collapses at every size
 *
 * Bashar, 2026-08-10: the same arrangement as the staff console. The hamburger is in the title row
 * at every width, the choice persists in `localStorage` and is applied before paint, the content
 * reclaims the column when the sidebar is hidden, and below `lg` the sidebar is a drawer with a
 * backdrop that Escape or a tap dismisses. All three controls come from `@safra/ui`, so the two
 * staff surfaces cannot drift apart the way two copies would.
 *
 * The layout itself is CSS (`portal-layout`, `portal-main`, `portal-sidebar`) rather than Tailwind
 * grid classes, because it depends on an attribute on `<html>` and has to be right in the first
 * painted frame.
 *
 * **Consequence, accepted:** hiding the sidebar hides sign-out and the theme toggle with it. That
 * is the price of putting the account controls at its foot, and it is acceptable only because the
 * hamburger is always available and brings them back in one press.
 */
export function Shell({
  title,
  partnerName,
  active,
  badges,
  children,
}: {
  readonly title: string;
  readonly partnerName: string;
  readonly active:
    | 'dashboard'
    | 'properties'
    | 'calendars'
    | 'payouts'
    | 'reviews'
    | 'contracts'
    | 'support';
  /**
   * The §7 sidebar badges — `عقاراتي 3` and `التقييمات ★ 4.7`.
   *
   * Optional, and each is rendered only when the caller passes a value. They were both held back
   * until reviews existed, because shipping `عقاراتي 3` beside a `التقييمات` with no number would
   * have implied the second was coming from data when it was not (gap report §8.5). Both are real
   * now: the count is the partner's listings and the rating is the trigger-maintained average over
   * published reviews.
   */
  readonly badges?: { readonly properties?: string; readonly reviews?: string };
  readonly children: React.ReactNode;
}) {
  return (
    <div className="portal-layout mx-auto max-w-[1380px] px-6 pt-6 pb-16">
      <main className="portal-main min-w-0">
        <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          {/*
            First in the row, so it is the first thing tab reaches and the first thing a thumb
            finds. Available at every width — the partner chooses whether the sidebar is there, on
            a phone and on a desktop alike.
          */}
          <SidebarToggle
            sidebarId={SIDEBAR_ID}
            showLabel={t.nav.showSidebar}
            hideLabel={t.nav.hideSidebar}
          />

          <h1 className="font-[family-name:var(--font-amiri)] text-[28px] leading-tight font-bold text-gold">
            {title}
          </h1>

          {/* `ms-auto`, not `justify-between`: with three items the latter would strand the title. */}
          <p className="ms-auto text-[12.5px] text-muted">{partnerName}</p>
        </header>

        {children}
      </main>

      {/*
        Second in the DOM, first in the desktop grid — `portal-sidebar` places it back in column 1
        from `lg` up.

        `tabIndex={-1}` makes it focusable by SCRIPT but not by tab, so opening the drawer can move
        focus into it without adding a stop to the desktop tab order where it is just a column.
        `aria-label` is on the aside rather than the nav: the aside is what the hamburger controls
        and what focus lands on, and labelling both would announce the same words twice.
      */}
      <aside
        id={SIDEBAR_ID}
        tabIndex={-1}
        aria-label={t.nav.heading}
        className="portal-sidebar flex flex-col rounded-[14px] border border-[rgba(var(--goldA),0.14)] bg-card p-3.5"
      >
        <p className="mb-2 px-2 text-[11px] tracking-wide text-faint">{partnerName}</p>

        {/*
          The NAV scrolls, not the whole sidebar.

          `min-h-0` is the load-bearing half: a flex item defaults to `min-height: auto` and refuses
          to shrink below its content, so on a short screen the rows would push the footer past the
          bottom of the drawer and sign-out would sit below the scroll.

          `content-start` is the other half, and it is why this differs from the console's nav.
          `flex-1` makes the nav fill the drawer, and a grid with free space DISTRIBUTES it across
          its rows — so four items in a full-height drawer came out as four 180px slabs. The console
          has nineteen rows, which overflow instead, so it never showed this. Pinning the rows to the
          start keeps a nav row the height of a nav row at any count.
        */}
        <nav className="grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto">
          <Item href="/" label={t.nav.dashboard} current={active === 'dashboard'} />
          <Item
            href="/properties"
            label={t.nav.properties}
            current={active === 'properties'}
            badge={badges?.properties}
          />
          {/* Directly under عقاراتي: it is the same inventory, seen by date rather than by listing. */}
          <Item
            href="/calendars"
            label={t.nav.calendars}
            current={active === 'calendars'}
          />
          <Item href="/payouts" label={t.nav.payouts} current={active === 'payouts'} />
          {/*
            العقود والمستندات — what SAFRA sent and what SAFRA is waiting for (Bashar, 2026-08-19).

            Above الدعم and below مستحقاتي: it is an obligation with a deadline, not a place to ask
            a question, and a partner who has just been accepted comes here first.
          */}
          <Item
            href="/contracts"
            label={t.nav.contracts}
            current={active === 'contracts'}
          />
          <Item
            href="/reviews"
            label={t.nav.reviews}
            current={active === 'reviews'}
            badge={badges?.reviews}
          />
          {/* Last: it is where a partner goes when something else on this list did not work. */}
          <Item
            href="/support"
            label={t.nav.supportPage}
            current={active === 'support'}
          />
        </nav>

        {/*
          The account controls, at the FOOT of the sidebar — the same decision the console records:
          a phone cannot hold a hamburger, a 28px title, the partner's name and two buttons on one
          line, and the wrap read as two headers.

          `mt-auto` pins them to the bottom of the DRAWER, which is full height, while on a desktop
          the aside is only as tall as its content so they sit immediately under the nav.
          One rule, both shapes, because the aside is a flex column.

          What used to sit between them was a «الدعم: partners@safra.com» line from the original
          handoff. Removed 2026-08-14 (Bashar): الدعم is a SCREEN now, one item up in this same nav,
          and it opens a tracked thread. An email address beside it offers a second, worse route —
          one with no reference, no status and no record on the partner's own account — and the two
          together make the reader choose between a channel we answer and one we do not.
        */}
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line2 pt-3">
          {/*
            `whenUnset='dark'` — لوحة الشريك is designed dark and its CSS has no
            `prefers-color-scheme` rule, so dark is what is on screen before anyone chooses.
          */}
          <ThemeToggle
            surface="partner"
            toLightLabel={t.nav.themeToLight}
            toDarkLabel={t.nav.themeToDark}
            whenUnset="dark"
          />

          {/*
            Sign out stays a plain form POST rather than the console's client button: it needs no
            JavaScript, and a GET that destroys a session is triggered by any prefetch that happens
            across it. `flex-1` so it takes the row beside the 40px toggle.
          */}
          <form action="/api/auth/logout" method="post" className="flex-1">
            <button
              type="submit"
              className="min-h-10 w-full cursor-pointer rounded-lg border border-line px-2.5 py-2 text-[12.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold"
            >
              {t.nav.signOut}
            </button>
          </form>
        </div>
      </aside>

      <SidebarBackdrop label={t.nav.hideSidebar} className="portal-backdrop" />
    </div>
  );
}

function Item({
  href,
  label,
  current,
  badge,
}: {
  readonly href: string;
  readonly label: string;
  readonly current: boolean;
  readonly badge?: string | undefined;
}) {
  return (
    <Link
      href={href}
      {...(current ? { 'aria-current': 'page' as const } : {})}
      className={`flex min-h-10 items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] transition-colors lg:min-h-0 ${
        current
          ? 'bg-[rgba(var(--goldA),0.12)] font-extrabold text-gold'
          : 'text-muted hover:bg-line2'
      }`}
    >
      {label}
      {/*
        `dir="ltr"`: a badge is a number, sometimes with a ★ in front of it, on an Arabic line.
        Pushed to the far side with `ms-auto` so it sits at the end of the row in either direction.
      */}
      {badge ? (
        <span
          dir="ltr"
          className="ms-auto rounded-full bg-[rgba(var(--skyA),0.15)] px-2 py-0.5 text-[10.5px] font-bold text-sky"
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
