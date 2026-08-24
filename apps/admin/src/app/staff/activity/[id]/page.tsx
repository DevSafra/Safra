import { getStaffActivityEntry } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { BackLink } from '@/components/back-link';
import { Ltr } from '@/components/admin-table';
import { backTarget } from '@/lib/search-params';
import { auditAction, auditSubject, payloadChanges, roleName, t } from '@/lib/strings';

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

  const changes = payloadChanges(entry.before, entry.after);

  return (
    <ConsoleShell title={t.sections.staff.activityEntry} counts={counts}>
      <BackLink target={back} section={t.nav.staff} />

      <div className="mt-4 grid gap-4">
        <ConsolePanel title={t.sections.staff.activityWhat}>
          <p className="text-[14px] font-bold text-text">{auditAction(entry.action)}</p>

          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Row term={t.sections.staff.activityWho}>
              {/* An address is a Latin run on a line of Arabic — the VALUE is isolated, not the pair. */}
              <Ltr>{entry.actorEmail ?? t.admin.systemActor}</Ltr>
              {(entry.actorRoleName ??
              (entry.actorRole ? roleName(entry.actorRole) : null)) ? (
                <span className="text-faint">
                  {' · '}
                  {entry.actorRoleName ?? roleName(entry.actorRole ?? '')}
                </span>
              ) : null}
            </Row>
            <Row term={t.sections.staff.activityWhen}>
              <Ltr>{shortDateTime(entry.createdAt)}</Ltr>
            </Row>
            <Row term={t.sections.staff.activitySubject}>
              {auditSubject(entry.subjectType)}
            </Row>
            {/*
              The IP is shown because سجل التدقيق shows it and this is the same row — a trail that
              names the action and withholds where it came from is a weaker trail on a screen that
              exists to answer "what exactly happened".
            */}
            {entry.ipAddress ? (
              <Row term={t.sections.staff.activityIp}>
                <Ltr>{entry.ipAddress}</Ltr>
              </Row>
            ) : null}
          </dl>

          {entry.reason ? (
            <p className="mt-3 text-[12.5px] text-text2">
              <span className="text-faint">{t.sections.staff.activityReason}: </span>
              {entry.reason}
            </p>
          ) : null}
        </ConsolePanel>

        <ConsolePanel title={t.sections.staff.activityChanges}>
          {changes.length === 0 ? (
            /*
              Many actions record nothing beyond the fact that they happened — a read, a resend. The
              screen says so rather than rendering an empty grid, which reads as a loading fault.
            */
            <p className="text-[12.5px] text-faint">
              {t.sections.staff.activityNoChanges}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="border-b border-line px-2.5 py-2 text-start text-[11px] font-bold text-faint"
                    >
                      {t.sections.audit.changeField}
                    </th>
                    <th
                      scope="col"
                      className="border-b border-line px-2.5 py-2 text-start text-[11px] font-bold text-faint"
                    >
                      {t.sections.audit.changeBefore}
                    </th>
                    <th
                      scope="col"
                      className="border-b border-line px-2.5 py-2 text-start text-[11px] font-bold text-faint"
                    >
                      {t.sections.audit.changeAfter}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((change) => (
                    <tr key={change.key}>
                      <th
                        scope="row"
                        className="border-b border-line2 px-2.5 py-2.25 text-start font-normal text-text2"
                      >
                        {change.label}
                      </th>
                      <td className="border-b border-line2 px-2.5 py-2.25 text-faint">
                        <bdi>{change.before ?? t.sections.audit.changeAbsent}</bdi>
                      </td>
                      <td className="border-b border-line2 px-2.5 py-2.25 text-text">
                        <bdi>{change.after ?? t.sections.audit.changeAbsent}</bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ConsolePanel>
      </div>
    </ConsoleShell>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-faint">{term}</dt>
      <dd className="mt-0.5 text-[12.5px] text-text">{children}</dd>
    </div>
  );
}
