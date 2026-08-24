import { getAuditActions, getAuditLog, type AuditEntry } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { clock, shortDate } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import { AdminTable, Ltr, type AdminColumn } from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { t, auditAction, auditSubject, roleName } from '@/lib/strings';
import { pageNumber } from '@/lib/search-params';
import { resolvePageSize } from '@/lib/table-size';
import { refuseSection } from '@/components/section-refusal';

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
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never
    runs: the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and
    signing in again lands them here again.
  */
  const refused = await refuseSection('audit', t.nav.audit);

  if (refused) return refused;

  const query = await searchParams;
  const first = (key: string): string | undefined => {
    const raw = query[key];
    const value = Array.isArray(raw) ? raw[0] : raw;

    return value?.trim() || undefined;
  };

  const action = first('action');
  const q = first('q');
  const page = pageNumber(first('page'));
  /*
    Rows per page from the URL, replacing a hardcoded 50. The audit log is the one table where a
    reader routinely wants a long page — reconstructing what happened means reading a sequence,
    not a screenful — so letting them ask for 100 matters more here than anywhere else.
  */
  // The URL wins, then this reader's saved size for audit, then ten — see `resolvePageSize`.
  const size = await resolvePageSize('audit', first('size'));

  const [entries, actionList, counts] = await Promise.all([
    getAuditLog({ action, actorEmail: q, page: String(page), limit: String(size) }),
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
          size={size}
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

        {entries === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : entries === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <>
            <AdminTable
              columns={COLUMNS}
              rows={entries.items}
              template={TEMPLATE}
              rowKey={(row) => row.id}
              minWidth={800}
              empty={t.table.empty}
            />
            <TablePagination
              basePath="/audit"
              section="audit"
              query={{ q, action }}
              page={entries.page}
              pages={entries.pages}
              total={entries.total}
              capped={entries.capped}
              size={size}
            />
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
    /*
      The NAME, falling back to the address — and `break-words`, not `break-all`.

      This column printed `actorEmail` with `break-all`, which in a 1fr column splits an address
      mid-token: «wallet-test-finance@safra.tes» on one line and a lone «t» on the next. It reads as
      a rendering fault, and on a screenshot of سجل التدقيق it is the first thing the eye finds.

      `break-words` breaks between tokens rather than inside them, so an address wraps instead of
      being severed.

      ## Why this does NOT prefer `actorName`

      It did, for about ten minutes, and a screenshot caught what no test did: the first three rows
      changed from «Admin» to the super admin's real name. `actor_email` is pseudonymised in the
      query — `actorName(u.email, u.role)` substitutes ADMIN_DISPLAY_NAME for a super admin — and
      `actor_name` selects `u.full_name` RAW beside it. Preferring the name walked straight around
      the control, and Bashar's rule (2026-08-23) is that a super admin acts under «Admin», not
      under an identity.

      Rendering `actorEmail` is therefore the correct source here: it is the field the server has
      already decided is safe to show. This is not the console choosing to hide something — hiding
      in a browser is not a control — it is the console reading the field that carries the decision.

      A null actor means the platform acted on its own — an expiry, a scheduled job.
    */
    render: (row) => (
      <div className="grid gap-0.5">
        <span className="break-words text-text">
          {row.actorEmail ?? t.admin.systemActor}
        </span>
        {/*
          The role NAME as recorded, in preference to translating its code (Bashar, 2026-08-23).

          Staff roles are rows now, so a super admin can rename «مشرف حجوزات» or retire it — and
          `roleName()` is a compile-time catalogue that can only ever know the four seeded ones.
          Resolving a dynamic role through it would print the raw identifier, which is exactly what
          «partner_employee» did on this screen an hour ago.

          `actor_role_name` is written at action time and immutable, so this says what the actor's
          authority was CALLED then rather than what that role is called now. The fallback covers
          every row written before the column existed.

          The condition reads either field: a row with a name and no enum value must still render,
          which is what every row written for a custom role will look like.
        */}
        {(row.actorRoleName ?? row.actorRole) ? (
          <span className="text-[10px] text-faint">
            {row.actorRoleName ?? roleName(row.actorRole ?? undefined)}
          </span>
        ) : null}
      </div>
    ),
  },
  {
    key: 'action',
    header: t.sections.audit.colAction,
    /*
      The action is the LINK into the entry, and the payload table is gone from the row
      (Bashar, 2026-08-24).

      Two of his messages, and they are one problem. He said "I saw that the سجل التدقيق page has no
      single detail page" — it had one, and every row already carried an href. What it did not carry
      was anything that LOOKED like a link: the href sat on the entity cell, styled as plain text.
      He was not reporting a missing feature, he was reporting that he could not find one.

      So the affordance moves to the action — the thing a reader looks at first to decide whether
      this row is the one — and takes the console's established link styling, `text-sky
      hover:underline`, the same as a booking reference on الحجوزات. No chevron: `›` carries
      Unicode's `Bidi_Mirrored` property and flips inside an RTL container, which the pagination bar
      documents the hard way.

      And the «الحقل / قبل / بعد» table left the row entirely — "because we have all informations on
      the single detail page of سجل, please remove this from the rows". It was right when the row
      was the only place a payload could be read; a seven-row table inside each of twenty-five
      entries makes the log unscannable, which is the one thing a log is for. The detail screen
      renders it unchanged.
    */
    render: (row) => (
      <div className="grid gap-0.5">
        <a
          href={`/audit/${row.id}`}
          aria-label={t.sections.staff.activityOpen}
          className="cursor-pointer text-sky hover:underline"
        >
          {auditAction(row.action)}
        </a>

        {row.reason ? (
          <span className="text-[10.5px] leading-relaxed text-faint">{row.reason}</span>
        ) : null}
      </div>
    ),
  },
  {
    key: 'entity',
    header: t.sections.audit.colEntity,
    /*
      The subject NAMED, and the whole row a link into its own screen.

      Bashar, 2026-08-24: "I want the سجل التدقيق items to be same as last activities. I mean every
      سجل should have a single very detailed page." The API resolves the subject, so «فندق الشام»
      replaces a truncated uuid — and where it cannot resolve one, the type and the truncated id are
      still printed rather than the row going quiet. An audit trail that hides what it cannot explain
      is worse than one that admits it.
    */
    render: (row) => (
      /*
        Not a link. It was one, to the same entry as the action beside it — and two controls a row
        apart going to one place is how a reader learns to distrust both. This cell answers WHAT the
        entry is about; the action opens it.
      */
      <div className="grid gap-0.5">
        <span className="text-[11px] text-faint">
          {auditSubject(row.subject?.type ?? row.subjectType)}
        </span>
        {row.subject?.label ? (
          <span className="text-[11.5px] text-text2">{row.subject.label}</span>
        ) : null}
        {row.subject?.reference ? (
          <Ltr className="text-[10.5px] text-sky">{row.subject.reference}</Ltr>
        ) : row.subjectId ? (
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
