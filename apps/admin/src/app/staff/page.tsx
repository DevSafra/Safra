import { getStaff, getStaffOverview, type StaffOverview } from '@/lib/api';
import { getStaffSession } from '@/lib/session-server';
import { sidebarCounts } from '@/lib/console';
import { count, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell, Kpi, KpiRow } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import { FootNote, Ltr } from '@/components/admin-table';
import { StaffAdmin } from '@/components/staff-admin';
import { ScopePanel } from '@/components/scope-panel';
import { auditAction, fill, roleName, t } from '@/lib/strings';
import { pageNumber, pageSize } from '@/lib/search-params';
import { listParamsFor } from '@/lib/table-size';

/**
 * الموظفون (M-5, SRS §4, design handoff §8.2).
 *
 * Four KPI cards, the staff table with its invite form, the permission matrix, and recent staff
 * activity — the design's four sections in its order.
 *
 * Only `super_admin` holds `staff.manage`, so the API returns 403 to everybody else and this page
 * says so rather than rendering an empty list. An empty list reads as "there are no staff", which
 * is both wrong and alarming.
 */
export const dynamic = 'force-dynamic';

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { page, size } = await listParamsFor('staff', searchParams);
  /*
    The scope map is the second paged table on this route, under its own parameters — see the note
    in `ScopePanel`. Read here rather than there so the accounts bar can carry them forward.
  */
  const params = await searchParams;
  const scope = {
    page: pageNumber(single(params['scopePage'])),
    size: pageSize(single(params['scopeSize'])),
  };

  const [result, overview, session, counts] = await Promise.all([
    getStaff({ page, limit: size }),
    getStaffOverview(),
    getStaffSession(),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.staff} counts={counts}>
      <div className="grid gap-4">
        {overview === 'failed' || overview === 'unauthenticated' ? null : (
          <Counters counters={overview.counters} />
        )}

        <ConsolePanel>
          {result === 'unauthenticated' ? (
            <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
          ) : result === 'failed' ? (
            <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
          ) : (
            <>
              <StaffAdmin staff={result.items} currentUserId={session?.user.id} />
              {/*
                Paged like every other registry (Bashar, 2026-08-05). This table used to render
                every staff account in one response — 165 rows on the development database, and
                growing with the company.
              */}
              <TablePagination
                basePath="/staff"
                section="staff"
                query={{
                  scopePage: String(scope.page),
                  scopeSize: String(scope.size),
                }}
                page={result.page}
                pages={result.pages}
                total={result.total}
                capped={result.capped}
                size={size}
                label={fill(t.table.paginationLabelOf, {
                  section: t.sections.staff.listLabel,
                })}
              />
            </>
          )}

          <FootNote>{t.sections.staff.note}</FootNote>
        </ConsolePanel>

        {/*
          نطاق العمل sits between the staff table and the permission matrix, because the two
          together are the whole answer to "what can this person do": the matrix says WHICH actions,
          the scope says WHERE.
        */}
        <ScopePanel
          page={scope.page}
          size={scope.size}
          query={{ page: String(page), size: String(size) }}
        />

        {overview === 'failed' || overview === 'unauthenticated' ? null : (
          <>
            <Matrix matrix={overview.matrix} />
            <Activity rows={overview.activity} />
          </>
        )}
      </div>
    </ConsoleShell>
  );
}

function Counters({ counters }: { counters: StaffOverview['counters'] }) {
  return (
    <KpiRow label={t.nav.staff}>
      <Kpi
        label={t.sections.staff.kpiTotal}
        value={count(counters.total)}
        sub={fill(t.sections.staff.kpiTotalSub, {
          active: count(counters.active),
          suspended: count(counters.suspended),
          invited: count(counters.invited),
        })}
      />
      <Kpi
        label={t.sections.staff.kpiSignedIn}
        value={count(counters.signedInToday)}
        valueClass="text-ok"
      />
      <Kpi
        label={t.sections.staff.kpiRoles}
        value={count(counters.rolesDefined)}
        valueClass="text-gold"
        sub={t.sections.staff.kpiRolesSub}
      />
      {/*
        The design's fourth card is "دعوات معلقة". This shows it, and swaps in the
        two-factor gap when there is one: an account with a password and no authenticator is a
        live hole in the console's own defence, and it outranks a pending invitation.
      */}
      {counters.twoFactorMissing > 0 ? (
        <Kpi
          label={t.sections.staff.kpiTwoFactor}
          value={count(counters.twoFactorMissing)}
          valueClass="text-bad"
        />
      ) : (
        <Kpi
          label={t.sections.staff.kpiInvites}
          value={count(counters.invited)}
          valueClass="text-warn"
          sub={t.sections.staff.kpiInvitesSub}
        />
      )}
    </KpiRow>
  );
}

/**
 * مصفوفة الصلاحيات — the permission matrix.
 *
 * Read from `ROLE_PERMISSIONS`, the exact constant `PermissionsGuard` checks on every request, so
 * §14's "enforced server-side, not just rendered" is satisfied by construction: the matrix cannot
 * drift from what the server allows, because there is only one source.
 *
 * ## Two states, not the design's three
 *
 * The handoff shows ✓ / ○ / — where ○ means "بموافقة مدير". There is no approval tier in the
 * model — a permission is granted or it is not — so rendering ○ would claim a workflow exists.
 * The legend says so instead of drawing a symbol that lies.
 */
function Matrix({ matrix }: { matrix: StaffOverview['matrix'] }) {
  return (
    <ConsolePanel>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <h2 className="text-[14.5px] font-extrabold text-gold">
          {t.sections.staff.matrix}
        </h2>
        <span className="text-[11.5px] text-faint">{t.sections.staff.matrixHint}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
          <colgroup>
            {/* The design's `1.8fr repeat(5, 1fr)` — one fewer role column, since `customer`
                and `partner` are not staff and do not belong in a console matrix. */}
            <col style={{ width: `${(1.8 / (1.8 + matrix.roles.length)) * 100}%` }} />
            {matrix.roles.map((role) => (
              <col
                key={role}
                style={{ width: `${(1 / (1.8 + matrix.roles.length)) * 100}%` }}
              />
            ))}
          </colgroup>

          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-line px-2.5 py-2 text-start text-[11px] font-bold text-faint"
              >
                {t.sections.staff.permission}
              </th>
              {matrix.roles.map((role) => (
                <th
                  key={role}
                  scope="col"
                  className="border-b border-line px-2.5 py-2 text-center text-[11px] font-extrabold text-gold"
                >
                  {roleName(role)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.permission}>
                <th
                  scope="row"
                  className="border-b border-line2 px-2.5 py-2.25 text-start font-normal text-text2"
                >
                  {row.permission}
                </th>
                {row.granted.map((granted, index) => (
                  <td
                    key={matrix.roles[index] ?? index}
                    className="border-b border-line2 px-2.5 py-2.25 text-center font-extrabold"
                  >
                    {/*
                      `aria-label` on each cell, because a screen reader reading "✓" out of a
                      grid of 250 identical glyphs cannot tell you which permission and role it
                      belongs to. The visible mark stays a single character.
                    */}
                    <span
                      className={granted ? 'text-ok' : 'text-faint2'}
                      aria-label={`${row.permission}: ${
                        granted ? t.sections.staff.allowed : t.sections.staff.denied
                      }`}
                    >
                      {granted ? '✓' : '—'}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-faint">
        <span>
          <b className="text-ok">✓</b> {t.sections.staff.allowed}
        </span>
        <span>
          <b className="text-faint2">—</b> {t.sections.staff.denied}
        </span>
      </div>

      <FootNote>{t.sections.staff.noApprovalTier}</FootNote>
    </ConsolePanel>
  );
}

/**
 * آخر نشاط الموظفين.
 *
 * From the audit log, not a separate feed: there is exactly one record of what staff did, it is
 * append-only by trigger, and a second store would be a second version of the truth.
 */
function Activity({ rows }: { rows: StaffOverview['activity'] }) {
  return (
    <ConsolePanel title={t.sections.staff.activity}>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-faint">{t.dashboard.nothingWaiting}</p>
      ) : (
        <ul className="grid gap-2.25 text-[12.5px]">
          {rows.map((row) => (
            <li
              key={`${row.at}-${row.action}`}
              className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-line bg-field px-3.25 py-2.5"
            >
              <span className="font-bold text-text">
                {row.actor ?? t.admin.systemActor}
              </span>
              <span className="text-text2">{auditAction(row.action)}</span>
              <span className="text-[11px] text-faint">{row.subjectType}</span>
              <Ltr className="ms-auto text-[11px] text-faint">
                {shortDateTime(row.at)}
              </Ltr>
            </li>
          ))}
        </ul>
      )}
    </ConsolePanel>
  );
}

/** Next hands a repeated query key as an array; the first value is the one that counts. */
function single(raw: string | string[] | undefined): string | undefined {
  return (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined;
}
