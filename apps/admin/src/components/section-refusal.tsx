import type { ConsoleSection } from '@safra/contracts';

import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { sectionAccess } from '@/lib/gate';
import { sidebarCounts } from '@/lib/console';
import { t } from '@/lib/strings';

/**
 * The branch every gated console page runs, in one place.
 *
 * ## Why a helper rather than the conditional written out per page
 *
 * There are 34 gated pages. Thirty-four copies of a two-line branch is how one of them ends up
 * saying «انتهت الجلسة» a month from now — which is the precise failure this whole change removes.
 * The page decides WHICH section it belongs to; this decides what a refusal looks like and, more
 * importantly, makes the shape impossible to get subtly wrong in one place out of thirty-four.
 *
 * ## It must be awaited BEFORE the page's own fetches
 *
 * Not a style preference. `staffFetch` maps a 403 to `'unauthenticated'` — deliberately, so that no
 * screen can be tempted into naming the capability somebody is missing. So a guard placed after the
 * page's `Promise.all` never runs at all: the fetch has already answered `'unauthenticated'`, the
 * page has already rendered «انتهت الجلسة», and the reader signs in again and lands in exactly the
 * same place. That is not a worse error message, it is a loop.
 *
 * Usage is two lines at the top of a page, above everything else:
 *
 *     const refused = await refuseSection('bookings', t.nav.bookings);
 *     if (refused) return refused;
 *
 * ## This is not the access control
 *
 * `@RequirePermissions` on the API is, and it is checked per request against a verified token. The
 * session here is DECODED, not verified — a web app holds no signing key — so a forged cookie buys
 * a misleading navigation in the forger's own browser and nothing else. What this decides is which
 * SENTENCE a reader sees instead of a refusal they cannot act on.
 */
export async function refuseSection(
  section: ConsoleSection,
  title: string,
): Promise<React.ReactNode | null> {
  const access = await sectionAccess(section);

  if (access === 'open') return null;

  /*
    The counts are still fetched, so the refusal renders inside the ordinary console rather than on
    a bare page. `sidebarCounts` swallows its own failure and answers zeroes, so it cannot turn a
    refusal into an error.
  */
  const counts = await sidebarCounts();

  return (
    <ConsoleShell title={title} counts={counts}>
      <ConsolePanel>
        {/*
          Deliberately plain: no heading, no icon, no «عذراً». A refusal that apologises reads as a
          fault in the product, and this is not a fault — it is the console describing the reader's
          role accurately.
        */}
        <p className="text-[13px] leading-relaxed text-muted">
          {access === 'closed' ? t.sections.gate.closed : t.sections.gate.role}
        </p>
      </ConsolePanel>
    </ConsoleShell>
  );
}
