import Link from 'next/link';

import {
  PARTNER_SECTION_PERMISSIONS,
  canOpenSection,
  type PartnerSection,
} from '@safra/contracts';
import { sessionPermissions } from '@safra/session';

import { SidebarBackdrop, SidebarToggle, ThemeToggle } from '@safra/ui';

import { SuspensionNotice } from '@/components/suspension-notice';
import { getMyProfile } from '@/lib/api';
import { SIDEBAR_ID, t } from '@/lib/strings';
import { getPartnerSession } from '@/lib/session-server';

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
export async function Shell({
  title,
  partnerName,
  active,
  badges,
  locked = false,
  children,
}: {
  readonly title: string;
  readonly partnerName: string;
  readonly active:
    | 'dashboard'
    | 'properties'
    | 'calendars'
    | 'arrivals'
    | 'violations'
    | 'payouts'
    | 'reviews'
    | 'contracts'
    | 'coupons'
    | 'employees'
    | 'employeeRoles'
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
  /**
   * An unverified partner sees two links, not seven (Bashar, 2026-08-21).
   *
   * العقود والمستندات, because it is the only thing they can act on, and الدعم, because the
   * rejected banner tells them to go there and a link that is not in the nav is not a route out.
   * Everything else would land on `requireVerifiedPartner` and bounce straight back — a nav made
   * of links that undo themselves.
   *
   * The account controls at the foot are untouched. Locking somebody out of sign-out because
   * their documents are under review would be a different bug.
   */
  readonly locked?: boolean;
  readonly children: React.ReactNode;
}) {
  /*
    Whether THIS reader may manage the team, read here rather than passed in by every page.

    The portal admits two roles, and `PARTNER_EMPLOYEE_MANAGE` is deliberately absent from
    `PARTNER_EMPLOYEE_PERMISSIONS` — a receptionist who could hire could promote themselves. So an
    employee must not be offered الموظفون: `partnerFetch` reports the API's 403 as
    `'unauthenticated'`, so the screen would say «انتهت الجلسة» and send them to sign in again over
    a permission, which cannot help.

    A control that is present exactly when the request would succeed is the rule we settled on the
    joint-contract path: a hidden control and a refused request must never disagree. The permission
    is the same fact the API enforces, so there is one answer rather than two.

    Read from the SESSION inside the shell rather than threaded through as a prop, because a prop
    is something eight pages have to remember and a ninth will not. This is presentation only — the
    API refuses the routes on its own authority whatever the sidebar draws.
  */
  const session = await getPartnerSession();
  const permissions = session ? sessionPermissions(session) : [];
  const opens = (section: PartnerSection): boolean =>
    canOpenSection(permissions, PARTNER_SECTION_PERMISSIONS, section);

  /*
    Deliberately narrowed to the success case. `getMyProfile` answers `'failed'` or
    `'unauthenticated'` as VALUES rather than throwing, and neither means "suspended" — so both
    fall through to no notice at all.
  */
  const profile = await getMyProfile();
  const suspension =
    profile === 'failed' || profile === 'unauthenticated' ? null : profile.suspension;

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
          {/*
            `data-partner-name` so a browser test can find WHICH business it is signed in as.

            The suspension spec has to suspend the partner whose session it holds, and the console
            registry deliberately does not search by email — so the name is the only handle, and
            scraping it by class would break the first time this row is restyled.
          */}
          <p data-partner-name className="ms-auto text-[12.5px] text-muted">
            {partnerName}
          </p>
        </header>

        {/*
          The hold, above the section, on EVERY screen — read here rather than passed in.

          Pages already hand this component a name and badges, and a fifth prop is the thing the
          ninth page forgets; the page that forgot would be the one where a suspended partner is
          left guessing why nothing works. `getMyProfile` is `cache()`d, so the page's own profile
          read and this one are a single request.

          A failed or unauthenticated read renders nothing rather than a notice: "we could not ask"
          is not "you are suspended", and inventing the second from the first would tell a partner
          in good standing that their account is on hold every time the API hiccups.
        */}
        {suspension ? <SuspensionNotice suspension={suspension} /> : null}

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
        className="portal-sidebar flex flex-col rounded-card border border-[rgba(var(--goldA),0.14)] bg-card p-3.5"
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
          {/*
            EVERY item is gated on the reader's own capabilities, not just the two that were.

            Until 2026-08-23 this list was fixed and an employee saw all of it, then met a refusal
            on arrival — which `partnerFetch` reports as «انتهت الجلسة», so the portal told somebody
            with a perfectly good session to sign in again over a permission. A hidden control and a
            refused request must not disagree, and doing that for two sections by hand while seven
            others stayed open was a rule enforced where somebody remembered it.

            `PARTNER_SECTION_PERMISSIONS` is the one map both apps read, so a section added without
            a permission is absent rather than open: `canOpenSection` answers FALSE for anything
            unmapped. That is the safe direction to fail — a missing entry hides a screen, it does
            not expose one.

            This is DISPLAY ONLY. The token is decoded, not verified, and every one of these routes
            is refused by the API on its own authority. What this fixes is the portal lying about
            what is available.
          */}
          {locked ? null : (
            <>
              {opens('dashboard') ? (
                <Item href="/" label={t.nav.dashboard} current={active === 'dashboard'} />
              ) : null}
              {opens('properties') ? (
                <Item
                  href="/properties"
                  label={t.nav.properties}
                  current={active === 'properties'}
                  badge={badges?.properties}
                />
              ) : null}
              {/* Directly under عقاراتي: the same inventory, seen by date rather than by listing. */}
              {opens('calendars') ? (
                <Item
                  href="/calendars"
                  label={t.nav.calendars}
                  current={active === 'calendars'}
                />
              ) : null}
              {/*
                الوصول اليوم — the desk screen, and for a receptionist it is the ONLY one that
                matters. High in the list rather than filed under administration: this is opened
                every shift, several times, usually on a phone at a counter.
              */}
              {opens('arrivals') ? (
                <Item
                  href="/arrivals"
                  label={t.nav.arrivals}
                  current={active === 'arrivals'}
                />
              ) : null}
              {opens('payouts') ? (
                <Item
                  href="/payouts"
                  label={t.nav.payouts}
                  current={active === 'payouts'}
                />
              ) : null}
            </>
          )}
          {/*
            العقود والمستندات — what SAFRA sent and what SAFRA is waiting for (Bashar, 2026-08-19).

            Above الدعم and below مستحقاتي: it is an obligation with a deadline, not a place to ask
            a question, and a partner who has just been accepted comes here first. While `locked`
            it is the FIRST item, because it is the only one that leads anywhere — and it stays
            visible while locked EVEN IF the reader cannot open it, because for an owner it is the
            destination the gate redirects to. An employee is refused there with a sentence rather
            than a session error; see the branch on that page.
          */}
          {locked || opens('contracts') ? (
            <Item
              href="/contracts"
              label={t.nav.contracts}
              current={active === 'contracts'}
            />
          ) : null}
          {locked ? null : (
            <>
              {/*
                الكوبونات — offers waiting on a decision. Hidden while locked, like every other
                working section: a partner who is not yet verified has no listings to discount.
              */}
              {opens('coupons') ? (
                <Item
                  href="/coupons"
                  label={t.nav.coupons}
                  current={active === 'coupons'}
                />
              ) : null}
              {opens('reviews') ? (
                <Item
                  href="/reviews"
                  label={t.nav.reviews}
                  current={active === 'reviews'}
                  badge={badges?.reviews}
                />
              ) : null}
              {/*
                المخالفات, below التقييمات: both are SAFRA's judgement of the business rather than
                its own work, and this is the one nobody opens unless something has gone wrong.
              */}
              {opens('violations') ? (
                <Item
                  href="/violations"
                  label={t.nav.violations}
                  current={active === 'violations'}
                />
              ) : null}
              {/*
                الموظفون and أدوار الموظفين, both on `partner_employee.manage`.

                Deliberately absent from `PARTNER_EMPLOYEE_PERMISSIONS`: a receptionist who could
                hire could promote themselves. Roles sit second because a role is the prerequisite —
                nobody can be invited until one exists — but the reader comes to الموظفون first and
                is sent here by it, rather than being asked to define a category of person before
                meeting the person.
              */}
              {opens('employees') ? (
                <Item
                  href="/employees"
                  label={t.nav.employees}
                  current={active === 'employees'}
                />
              ) : null}
              {opens('employeeRoles') ? (
                <Item
                  href="/employee-roles"
                  label={t.nav.employeeRoles}
                  current={active === 'employeeRoles'}
                />
              ) : null}
            </>
          )}
          {/*
            الدعم is UNGATED, deliberately, and it is the one exemption in this list.

            It is absent from `PARTNER_SECTION_PERMISSIONS` on purpose — `canOpenSection` answers
            false for anything unmapped, so adding it to the map to make this loop tidier would
            HIDE it from every employee. Somebody whose role opens no other section is exactly the
            person who most needs to ask why, and a portal that shows them nothing at all and no way
            to ask is a dead end.

            Last in the list because it is where a partner goes when something else on it did not
            work.
          */}
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
