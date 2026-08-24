import { getStaffActivityEntry } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { AuditEntryDetail } from '@/components/audit-entry-detail';
import { BackLink } from '@/components/back-link';
import { backTarget } from '@/lib/search-params';
import { t } from '@/lib/strings';
import { refuseSection } from '@/components/section-refusal';

/**
 * تفاصيل النشاط — one entry from آخر نشاط الموظفين.
 *
 * Bashar offered this as optional (2026-08-24): "if you want you can also create a single detailed
 * page for every نشاط of the list. To explain exactly what happened."
 *
 * ## Why it explains generically rather than per action
 *
 * There are seventy-odd actions and `before`/`after` are arbitrary `jsonb`. Seventy bespoke
 * sentences would be seventy things to keep in step with the services that write them, and the way
 * that fails is silent: an action changes what it records, the sentence describing it does not, and
 * the screen confidently explains something that did not happen. Worse, action seventy-one gets no
 * explanation at all and the screen simply says nothing about it.
 *
 * So it renders what the row actually holds — the action named in Arabic, who did it, when, and the
 * payload as labelled before/after pairs, the same renderer سجل التدقيق uses. That is true for every
 * action including ones added next month. A sentence for a handful of high-traffic actions could be
 * added ON TOP of this later; it must never replace it.
 *
 * ## Not a second door onto the whole trail
 *
 * The API answers 404 for an id naming a customer's or a partner's action, not only for one naming
 * nothing. This screen is reached with `staff.manage`; reading the whole audit log is
 * `audit_log.read`, a different capability. "Not yours" and "not there" answer the same way.
 */
export const dynamic = 'force-dynamic';

export default async function StaffActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never
    runs: the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and
    signing in again lands them here again.
  */
  const refused = await refuseSection('staff', t.nav.staff);

  if (refused) return refused;

  const { id } = await params;
  const query = await searchParams;
  /* Built from the LITERAL '/staff', never from a path in the URL. */
  const back = backTarget('/staff', query);

  const [entry, counts] = await Promise.all([getStaffActivityEntry(id), sidebarCounts()]);

  if (entry === 'unauthenticated' || entry === 'failed') {
    return (
      <ConsoleShell title={t.sections.staff.activityEntry} counts={counts}>
        <BackLink target={back} section={t.nav.staff} />
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
      <BackLink target={back} section={t.nav.staff} />

      <div className="mt-4">
        {/*
          The SAME component سجل التدقيق renders. Two screens over one `audit_log` row would drift,
          and the way that fails is that one event reads differently depending on which list you
          opened it from — which is the one thing an audit trail cannot afford.
        */}
        <AuditEntryDetail entry={entry} />
      </div>
    </ConsoleShell>
  );
}
