import { SidebarToggle } from '@safra/ui';

import { todayLong } from '@/lib/format';
import { getStaffSession } from '@/lib/session-server';
import { SIDEBAR_ID, roleName, t } from '@/lib/strings';

/**
 * The title row every console section shares: hamburger, title · date · role, section actions.
 *
 * ## Why this is a component and not markup in two places
 *
 * It was in two places — the dashboard wrote its own header and `ConsoleShell` wrote another —
 * and they drifted the moment the date and role line was added to both. The dashboard put the
 * meta beside the `h1`; the shell put it after the whole title block, which is as wide as its
 * widest child, so on the two sections with a long subtitle the date ended up most of the way
 * across the header, attached to nothing. Bashar reported exactly that on الشركاء and العقارات.
 *
 * Two copies of a header will differ again, so there is now one. The dashboard's extra control
 * arrives through `actions` rather than being special-cased here.
 *
 * ## Reads the session itself
 *
 * Nineteen sections render this and only one had a reason to load a session, so a prop would have
 * meant nineteen edits. The read is a cookie lookup and a JWT decode — no network, no database.
 *
 * Importing `session-server` is safe here because nothing that imports this is a client
 * component; `server-only` throws at BUILD time, and this console has already been broken once
 * by a client component reaching a server module through a formatting helper.
 */
export async function ConsoleHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  /** Section-specific controls. The account controls live in the sidebar, not here. */
  actions?: React.ReactNode;
}) {
  const session = await getStaffSession();

  return (
    <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      {/*
        First in the row, so it is the first thing tab reaches and the first thing a thumb finds.
        Available at every width — the operator chooses whether the sidebar is there, on a phone
        and on a desktop alike.
      */}
      <SidebarToggle
        sidebarId={SIDEBAR_ID}
        showLabel={t.nav.showSidebar}
        hideLabel={t.nav.hideSidebar}
      />

      {/*
        Title and meta share an inner row; the subtitle sits UNDER both. That is what keeps the
        line next to the title on a section that has a subtitle and on one that does not.

        `items-baseline` rather than centring: at 28px against 11.5px, a shared baseline reads as
        one line of text, where centring leaves the small type floating in the middle of the
        large. `min-w-0` so a long title can shrink instead of forcing the header wider than the
        column — the sole reason the whole page could scroll sideways on a phone.
      */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-[family-name:var(--font-amiri)] text-[28px] leading-tight text-text">
            {title}
          </h1>
          <span className="text-[11.5px] text-faint">
            {todayLong()} · {roleName(session?.user.role)}
          </span>
        </div>

        {subtitle ? <p className="mt-0.5 text-[11.5px] text-faint">{subtitle}</p> : null}
      </div>

      {/*
        Only section-specific actions live here now. The theme toggle and sign-out moved to the
        foot of the sidebar: on a phone they wrapped below the title, which read as two headers.
        `actions` stays because it belongs to the SECTION — the dashboard's Emergency Mode control
        is about the page, not about the account.
      */}
      {actions ? <div className="ms-auto flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
