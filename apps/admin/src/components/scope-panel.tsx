import { getStaffScopes, type StaffScopeRow } from '@/lib/api';
import { ConsolePanel } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import {
  AdminTable,
  FootNote,
  Ltr,
  StatusPill,
  type AdminColumn,
  type Tone,
} from '@/components/admin-table';
import { fill, t, roleName } from '@/lib/strings';

/**
 * نطاق العمل — the scope map (design handoff §8.2, Bashar's decision 2026-08-04).
 *
 * ## The note is not decoration
 *
 * The panel states that scope is enforced SERVER-SIDE and lists what it covers. That sentence is
 * the difference between a column somebody trusts and a column somebody has to go and verify: the
 * whole reason this was not built as a display-only field is that a scope which is shown but not
 * enforced is worse than no scope at all.
 *
 * It also states that the audit log stays complete, because that is the one place an operator might
 * reasonably assume scope applies and it deliberately does not.
 *
 * ## Read-only here
 *
 * Setting a scope is `PUT /admin/staff/:id/scope` and it revokes the member's sessions when it
 * narrows. A form for that belongs on the member's own record with a confirmation, not inline in a
 * table where a mis-click logs a colleague out mid-shift.
 */
/**
 * `/staff` holds TWO paged tables, so this one namespaces its URL parameters.
 *
 * `?scopePage=`/`?scopeSize=` rather than `?page=`/`?size=`: sharing them would move the accounts
 * registry and the scope map together, and stepping through 165 scopes would drag the reader's
 * place in the accounts list along with it. The `query` carries the OTHER table's position, so
 * paging either one leaves the other where it was.
 */
export async function ScopePanel({
  page,
  size,
  query,
}: {
  readonly page: number;
  readonly size: number;
  readonly query: Record<string, string | undefined>;
}) {
  const result = await getStaffScopes({ page, limit: size });

  return (
    <ConsolePanel title={t.sections.staff.scopeTitle}>
      {result === 'unauthenticated' ? (
        <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
      ) : result === 'failed' ? (
        <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
      ) : (
        <>
          <AdminTable
            columns={COLUMNS}
            rows={result.items}
            template="1.6fr 1fr 1.6fr 1.1fr"
            rowKey={(row) => row.userId}
            minWidth={620}
            empty={t.table.empty}
          />
          <TablePagination
            basePath="/staff"
            section="staffScope"
            query={query}
            page={result.page}
            pages={result.pages}
            total={result.total}
            capped={result.capped}
            size={size}
            label={fill(t.table.paginationLabelOf, {
              section: t.sections.staff.scopeTitle,
            })}
          />
        </>
      )}

      <FootNote>{t.sections.staff.scopeNote}</FootNote>
    </ConsolePanel>
  );
}

const COLUMNS: readonly AdminColumn<StaffScopeRow>[] = [
  {
    key: 'email',
    header: t.sections.staff.inviteEmail,
    render: (row) => <Ltr className="break-all text-text">{row.email}</Ltr>,
  },
  {
    key: 'role',
    header: t.sections.staff.inviteRole,
    render: (row) => <span className="text-text2">{roleName(row.role)}</span>,
  },
  {
    key: 'scope',
    header: t.sections.staff.scope,
    /*
      A super admin is shown as unscopable rather than as "all cities". Both are true, and the
      first one is the fact that matters: it explains why there is no control for them.
    */
    render: (row) =>
      row.role === 'super_admin' ? (
        <span className="text-[11.5px] text-faint">
          {t.sections.staff.scopeSuperAdmin}
        </span>
      ) : row.kind === 'all_cities' ? (
        <StatusPill tone="sky">{t.sections.staff.scopeAllCities}</StatusPill>
      ) : row.cities.length === 0 ? (
        /*
          A `cities` scope with no cities restricts nothing — see `isRestricted`. Saying "all
          cities" here would hide a half-finished configuration, so it says what it is.
        */
        <span className="text-[11.5px] text-warn">
          {t.sections.staff.scopeAllCities} ({t.sections.staff.scopeNever})
        </span>
      ) : (
        <span className="text-[12px] text-text">
          {row.cities.map((city) => city.nameAr).join(' · ')}
        </span>
      ),
  },
  {
    key: 'outside',
    header: t.table.colType,
    render: (row) =>
      row.role === 'super_admin' || row.kind === 'all_cities' ? (
        <span className="text-faint">{t.admin.noData}</span>
      ) : (
        <StatusPill tone={outsideTone(row.outside)}>
          {row.outside === 'read_only'
            ? t.sections.staff.scopeOutsideReadOnly
            : t.sections.staff.scopeOutsideNone}
        </StatusPill>
      ),
  },
];

/** `none` is the stricter mode, so it reads as the affirmative one. */
function outsideTone(outside: string): Tone {
  return outside === 'read_only' ? 'warn' : 'ok';
}
