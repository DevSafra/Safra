import Link from 'next/link';

import type { AuditEntry } from '@/lib/api';
import { ConsolePanel } from '@/components/console-shell';
import { Ltr } from '@/components/admin-table';
import { shortDateTime } from '@/lib/format';
import { auditAction, auditSubject, payloadChanges, roleName, t } from '@/lib/strings';

/**
 * One `audit_log` row, explained — the whole of it, on one screen.
 *
 * ## One component, two entry points
 *
 * سجل التدقيق and آخر نشاط الموظفين render the SAME rows: the second is the first with a narrower
 * predicate. Two detail screens over one row would drift, and the way that fails is that the same
 * event reads differently depending on which list you opened it from — which is precisely what an
 * audit trail cannot afford. `/audit/[id]` and `/staff/activity/[id]` both render this.
 *
 * ## It NAMES the thing it happened to
 *
 * Bashar, 2026-08-24: "when an activity says (e.g. الموافقة على الشريك) can you write the partner
 * name (details) so me as a super admin can really know everything in details. Set that as a rule
 * for the future also." So «الموافقة على الشريك» reads «الموافقة على الشريك — فندق الشام
 * (PAR-000123)», and the reference links to the record where a console screen exists.
 *
 * The resolution is the API's, not this component's. Resolving it here would be a fetch per row and
 * a SECOND answer to what a record is called; the trail and the registry would eventually disagree
 * about a partner's name and the trail would be the one that was wrong.
 *
 * **A subject that could not be resolved is printed raw, not hidden.** A trail that quietly omits
 * what it cannot explain is worse than one that admits it — an entry with no name still tells you
 * an action happened, to a record of a known type, at a known time, by a known person.
 *
 * ## Why the changes are rendered generically
 *
 * There are seventy-odd actions and `before`/`after` are arbitrary `jsonb`. Seventy hand-written
 * explanations would be seventy things to keep in step with the services that write them, and the
 * failure is silent: an action changes what it records, its sentence does not, and the screen
 * confidently explains something that did not happen. Worse, action seventy-one gets nothing.
 *
 * The generic renderer is true for every action including ones added next month. A sentence for a
 * handful of high-traffic actions could be added ON TOP of it later; it must never replace it.
 */
export function AuditEntryDetail({ entry }: { entry: AuditEntry }) {
  const changes = payloadChanges(entry.before, entry.after);
  const subject = entry.subject ?? null;

  return (
    <div className="grid gap-4">
      <ConsolePanel title={t.sections.staff.activityWhat}>
        <p className="text-[14px] font-bold text-text">
          {auditAction(entry.action)}
          {/*
            The subject on the SAME line as the action, because together they are the sentence.
            «الموافقة على الشريك» and «فندق الشام» on separate lines is two facts to assemble; on one
            line it is what happened.
          */}
          {subject?.label ? (
            <span className="text-text2">{` — ${subject.label}`}</span>
          ) : null}
        </p>

        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Row term={t.sections.staff.activitySubject}>
            {subject === null ? (
              /*
                Unresolvable, and said so. The type still names WHAT kind of record it was, and the
                id is printed because it is the only handle anybody has on it — a support engineer
                can query it even where the console has no screen.
              */
              <>
                {auditSubject(entry.subjectType)}
                {entry.subjectId ? (
                  <Ltr className="text-faint">{` ${entry.subjectId}`}</Ltr>
                ) : null}
              </>
            ) : (
              <>
                {auditSubject(subject.type)}
                {subject.reference ? (
                  <>
                    {' · '}
                    {subject.href ? (
                      /* Linked only where a console screen exists — six of twenty-two types. */
                      <Link
                        href={subject.href}
                        className="cursor-pointer text-gold hover:underline"
                      >
                        <Ltr>{subject.reference}</Ltr>
                      </Link>
                    ) : (
                      <Ltr>{subject.reference}</Ltr>
                    )}
                  </>
                ) : null}
              </>
            )}
          </Row>

          <Row term={t.sections.staff.activityWho}>
            {/*
              The NAME where the account has one, with the address beside it — two people share a
              name long before they share a mailbox, and an audit trail is exactly where that
              distinction has to survive.
            */}
            {entry.actorName ? (
              <>
                {entry.actorName}
                <Ltr className="text-faint">{` ${entry.actorEmail ?? ''}`}</Ltr>
              </>
            ) : (
              <Ltr>{entry.actorEmail ?? t.admin.systemActor}</Ltr>
            )}
            {(entry.actorRoleName ?? entry.actorRole) ? (
              <span className="text-faint">
                {' · '}
                {entry.actorRoleName ?? roleName(entry.actorRole ?? '')}
              </span>
            ) : null}
          </Row>

          <Row term={t.sections.staff.activityWhen}>
            <Ltr>{shortDateTime(entry.createdAt)}</Ltr>
          </Row>

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
            Many actions record nothing beyond the fact that they happened — a read, a resend. Said
            in words rather than left as an empty grid, which reads as a loading fault.
          */
          <p className="text-[12.5px] text-faint">{t.sections.staff.activityNoChanges}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {[
                    t.sections.audit.changeField,
                    t.sections.audit.changeBefore,
                    t.sections.audit.changeAfter,
                  ].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="border-b border-line px-2.5 py-2 text-start text-[11px] font-bold text-faint"
                    >
                      {heading}
                    </th>
                  ))}
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
