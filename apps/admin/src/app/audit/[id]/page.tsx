import { getAuditEntry } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { AuditEntryDetail } from '@/components/audit-entry-detail';
import { BackLink } from '@/components/back-link';
import { refuseSection } from '@/components/section-refusal';
import { backTarget } from '@/lib/search-params';
import { t } from '@/lib/strings';

/**
 * One سجل التدقيق entry on its own screen.
 *
 * Bashar, 2026-08-24: "I want the سجل التدقيق items to be same as last activities. I mean every
 * سجل should have a single very detailed page. provide all informations nicely about the سجل".
 *
 * ## The same component as آخر نشاط, deliberately
 *
 * `AuditEntryDetail` renders both. They are the same `audit_log` row — آخر نشاط is سجل التدقيق with
 * a narrower predicate — and two screens over one row drift into showing one event differently
 * depending on which list you opened it from.
 *
 * ## Two doors, two keys
 *
 * This route is gated on `audit_log.read`, which opens the WHOLE trail; `/staff/activity/[id]` is
 * gated on `staff.manage`, which opens only what staff did, and the API enforces that narrowing on
 * its own endpoint. Sharing the fetch between them would have handed every staff manager the
 * platform-wide trail, so the two screens share a renderer and nothing else.
 */
export const dynamic = 'force-dynamic';

export default async function AuditEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never runs:
    the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and signing in
    again lands them here again.
  */
  const refused = await refuseSection('audit', t.nav.audit);

  if (refused) return refused;

  const { id } = await params;
  const query = await searchParams;
  /* Built from the LITERAL '/audit', never from a path in the URL. */
  const back = backTarget('/audit', query);

  const [entry, counts] = await Promise.all([getAuditEntry(id), sidebarCounts()]);

  if (entry === 'unauthenticated' || entry === 'failed') {
    return (
      <ConsoleShell title={t.sections.staff.activityEntry} counts={counts}>
        <BackLink target={back} section={t.nav.audit} />
        <ConsolePanel>
          <p className="mt-4 text-[12.5px] text-muted">
            {entry === 'unauthenticated'
              ? t.dashboard.sessionExpired
              : t.sections.staff.activityNotFound}
          </p>
        </ConsolePanel>
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell title={t.sections.staff.activityEntry} counts={counts}>
      <BackLink target={back} section={t.nav.audit} />

      <div className="mt-4">
        <AuditEntryDetail entry={entry} />
      </div>
    </ConsoleShell>
  );
}
