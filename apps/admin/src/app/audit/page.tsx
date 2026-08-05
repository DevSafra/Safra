import { getAuditActions, getAuditLog, type AuditEntry } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { clock, shortDate } from '@/lib/format';
import { ConsolePanel, ConsoleShell, Pager } from '@/components/console-shell';
import { AdminTable, Ltr, type AdminColumn } from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { t, auditAction, roleName } from '@/lib/strings';

/**
 * سجل التدقيق (SRS §15, design handoff §8).
 *
 * ## Append-only, and the screen says so
 *
 * The design leads with a red "غير قابل للحذف" badge, and it is not decoration: `audit_log`
 * rejects UPDATE and DELETE by database trigger, so even a compromised admin session cannot edit
 * history. Telling the operator that is what makes the log worth consulting — a record that might
 * have been tampered with answers nothing.
 *
 * ## Filtered, not free-text searched
 *
 * Every filter maps onto an existing index: action prefix and actor email. The obvious next
 * request is free text over the `before`/`after` payloads, and it is deliberately absent — those
 * columns hold redacted jsonb, an unindexed scan over a table that only grows would become the
 * slowest query in the system, and the honest way to find "the change that set the fee to 1.99"
 * is to filter by action and read.
 *
 * So the design's single search box is an ACTOR filter plus an action select. Recorded as a
 * documented deviation in `docs/design-gap-report.md`.
 *
 * ## `before`/`after` are shown verbatim
 *
 * A summary would lose the one detail the question usually turns on: which value, exactly,
 * changed to what. Rendered under the action rather than in its own column, so the row only grows
 * for the entries that carry a payload.
 */
export const dynamic = 'force-dynamic';

/** The design's `grid-template-columns`, verbatim. */
const TEMPLATE = '.7fr 1fr 2fr 1fr .9fr';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const first = (key: string): string | undefined => {
    const raw = query[key];
    const value = Array.isArray(raw) ? raw[0] : raw;

    return value?.trim() || undefined;
  };

  const action = first('action');
  const q = first('q');
  const cursor = first('cursor');

  const [page, actionList, counts] = await Promise.all([
    getAuditLog({ action, actorEmail: q, cursor, limit: '50' }),
    getAuditActions(),
    sidebarCounts(),
  ]);

  const actions =
    actionList === 'failed' || actionList === 'unauthenticated' ? [] : actionList.actions;

  return (
    <ConsoleShell title={t.nav.audit} counts={counts}>
      <ConsolePanel>
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          {/* The immutability badge, in the design's exact treatment. */}
          <span className="rounded-full border border-[rgba(var(--badA),0.4)] bg-[rgba(var(--badA),0.12)] px-3 py-0.5 text-[10.5px] font-extrabold text-bad">
            {t.sections.audit.immutable}
          </span>
          <span className="text-xs text-faint">{t.sections.audit.hint}</span>
        </div>

        <TableToolbar
          action="/audit"
          query={q}
          placeholder={t.sections.audit.searchPlaceholder}
        >
          <select
            name="action"
            defaultValue={action ?? ''}
            aria-label={t.sections.audit.colAction}
            className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
          >
            <option value="">{t.sections.bookings.allStatuses}</option>
            {actions.map((value) => (
              <option key={value} value={value}>
                {auditAction(value)}
              </option>
            ))}
          </select>
        </TableToolbar>

        {page === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : page === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <>
            <AdminTable
              columns={COLUMNS}
              rows={page.items}
              template={TEMPLATE}
              rowKey={(row) => row.id}
              minWidth={800}
              empty={t.table.empty}
            />
            <Pager basePath="/audit" query={{ q, action }} nextCursor={page.nextCursor} />
          </>
        )}
      </ConsolePanel>
    </ConsoleShell>
  );
}

const COLUMNS: readonly AdminColumn<AuditEntry>[] = [
  {
    key: 'time',
    header: t.table.colTime,
    /*
      Clock above date. The log is read newest-first within a day, so the time distinguishes
      adjacent rows and the date is context — the design shows only the clock, which works for
      four demo rows and not for fifty spanning a week.
    */
    render: (row) => (
      <div className="grid gap-0.5">
        <Ltr className="text-sky">{clock(row.createdAt)}</Ltr>
        <Ltr className="text-[10px] text-faint">{shortDate(row.createdAt)}</Ltr>
      </div>
    ),
  },
  {
    key: 'actor',
    header: t.sections.audit.colStaff,
    /* A null actor means the platform acted on its own — an expiry, a scheduled job. */
    render: (row) => (
      <div className="grid gap-0.5">
        <span className="break-all text-text">
          {row.actorEmail ?? t.admin.systemActor}
        </span>
        {row.actorRole ? (
          <span className="text-[10px] text-faint">{roleName(row.actorRole)}</span>
        ) : null}
      </div>
    ),
  },
  {
    key: 'action',
    header: t.sections.audit.colAction,
    render: (row) => (
      <div className="grid gap-0.5">
        <span className="text-text2">{auditAction(row.action)}</span>

        {row.reason ? (
          <span className="text-[10.5px] leading-relaxed text-faint">{row.reason}</span>
        ) : null}

        {/* Verbatim payload — see the module note on why it is not summarised. */}
        {row.before !== null || row.after !== null ? (
          <pre className="mt-1 overflow-x-auto rounded border border-line bg-field p-1.5 text-[10px] text-faint">
            {JSON.stringify({ before: row.before, after: row.after })}
          </pre>
        ) : null}
      </div>
    ),
  },
  {
    key: 'entity',
    header: t.sections.audit.colEntity,
    /*
      Subject type plus a truncated id. A bare uuid says nothing; the type beside it turns an
      opaque key into something an operator can act on, and eight characters is enough to match
      against a full id they already hold.
    */
    render: (row) => (
      <div className="grid gap-0.5">
        <span className="text-[11px] text-faint">{row.subjectType}</span>
        {row.subjectId ? (
          <Ltr className="text-[10.5px] text-sky">{row.subjectId.slice(0, 8)}</Ltr>
        ) : null}
      </div>
    ),
  },
  {
    key: 'ip',
    header: t.sections.audit.colIp,
    render: (row) => <Ltr className="text-muted">{row.ipAddress ?? t.admin.noData}</Ltr>,
  },
];
