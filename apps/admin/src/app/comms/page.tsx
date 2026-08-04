import { sidebarCounts } from '@/lib/console';
import { ConsoleShell, NotBuilt } from '@/components/console-shell';
import { AR } from '@/lib/strings';

/**
 * Comms — present in the design (handoff §8), not yet backed by any table.
 *
 * The route exists so the sidebar item leads somewhere that EXPLAINS itself, rather than to a
 * 404 or to an empty table. An empty table would be read as "there are none", which for disputes
 * and messages is a materially different — and much worse — claim than "not built".
 *
 * What it needs and where it sits in the order is in `docs/design-gap-report.md` §4.
 */
export const dynamic = 'force-dynamic';

export default async function CommsPage() {
  const counts = await sidebarCounts();

  return (
    <ConsoleShell title={AR.nav.whatsapp} counts={counts}>
      <NotBuilt reason={AR.unbuilt.comms} />
    </ConsoleShell>
  );
}
