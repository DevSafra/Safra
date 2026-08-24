import {
  getStaff,
  getStaffActivity,
  getStaffOverview,
  getStaffRoles,
  type StaffOverview,
} from '@/lib/api';
import { getStaffSession } from '@/lib/session-server';
import { sidebarCounts } from '@/lib/console';
import { count, shortDate, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell, Kpi, KpiRow } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import { FootNote, Ltr } from '@/components/admin-table';
import { StaffInvite } from '@/components/staff-invite';
import { auditAction, auditSubject, fill, roleName, t } from '@/lib/strings';
import { first, returnQuery, rowAnchor } from '@/lib/search-params';
import { listParamsFor } from '@/lib/table-size';

/**
 * الموظفون (M-5, SRS §4, design handoff §8.2).
 *
 * ## What this page is, after Bashar's 2026-08-23 review
 *
 * "The الموظفون page on super admin dashboard is too complicated." It carried six things: counters,
 * the table, the invite form, نطاق العمل, مصفوفة الصلاحيات and آخر نشاط الموظفين. Three of those are
 * now elsewhere and the page answers one question — **who works here** — with the counters, the
 * invite, and a list of people you can open.
 *
 * - **مصفوفة الصلاحيات is gone.** Roles are rows a super admin defines, so «أدوار الموظفين» is where
 *   you read what a role carries. A matrix beside it was a second rendering of the same fact.
 * - **نطاق العمل moved to the member's own record.** A scope is a property of a PERSON; a paged
 *   table of everybody's scopes sat on this page because there was nowhere else to put it.
 * - **آخر نشاط STAYS**, at the bottom. I removed it in the first pass and Bashar put it back the
 *   same evening — "add the employee history at the bottom under دعوة موظف جديد back". He is
 *   right and my reasoning was wrong: سجل التدقيق has the platform-wide record, but somebody
 *   managing staff wants to see what staff have been doing without leaving the screen they manage
 *   them from, and sending them to another section to find out is not a simplification.
 *
 * There is no PER-PERSON activity on the member's record yet — the detail payload carries no
 * history, and an earlier version of this comment claimed the panel had moved there, which was
 * never true. It is worth building; it is not built. `docs/FUTURE-WORK.md`, O-staff-2.
 *
 * Only `super_admin` holds `staff.manage`, so the API returns 403 to everybody else and this page
 * says so rather than rendering an empty list. An empty list reads as "there are no staff", which is
 * both wrong and alarming.
 */
export const dynamic = 'force-dynamic';

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { page, size } = await listParamsFor('staff', searchParams);
  /*
    آخر نشاط is the SECOND paged list on this route, so its page and size are namespaced —
    `?activityPage=`/`?activitySize=`. Sharing `?page=` would drag the reader's place in the
    accounts registry along every time they stepped through the activity.
  */
  const activity = await listParamsFor('staffActivity', searchParams);
  const params = await searchParams;
  const activityTerm = first(params, 'activityQ');

  const [result, overview, activityPage, session, counts, roles] = await Promise.all([
    getStaff({ page, limit: size }),
    getStaffOverview(),
    getStaffActivity({
      page: activity.page,
      limit: activity.size,
      q: activityTerm,
    }),
    getStaffSession(),
    sidebarCounts(),
    /*
      The named roles, once per page load rather than per row (Bashar, 2026-08-23).

      Only the invite form needs them now that the row controls have moved, but it is still one
      request whatever the page size. A failed read leaves the select with no options — which is
      honest: the screen cannot offer a role it could not confirm exists, and the rest of الموظفون
      still renders.
    */
    getStaffRoles(),
  ]);

  /*
    Carried into every row's href so opening somebody and coming back returns to this page of this
    list, scrolled to them (`.claude/CLAUDE.md`, "Opening a row and coming back").
  */
  const back = returnQuery({ page, size });

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
            <div className="grid gap-6">
              {/*
                A failed roles read yields no options rather than a broken screen — and the API
                answers 403 to a staff manager without `staff_role.manage`, which `staffFetch` maps
                to 'unauthenticated'. That must not become a sign-in loop on a page the reader is
                entitled to: the invite form loses its picker, the list stays.
              */}
              <StaffInvite
                roles={
                  roles === 'failed' || roles === 'unauthenticated' ? [] : roles.roles
                }
              />

              <ul aria-label={t.sections.staff.listLabel} className="grid gap-2">
                {result.items.map((member) => (
                  <li
                    key={member.id}
                    /*
                      One function writes both the `id` and the `#fragment` the detail screen sends
                      the reader back to. Written separately they drift, and the failure is silent.
                    */
                    id={rowAnchor(member.id)}
                    className="scroll-mt-24 rounded-lg border border-line bg-card target:border-gold/50 target:bg-gold/5"
                  >
                    <a
                      href={`/staff/${member.id}${back}`}
                      aria-label={fill(t.sections.staff.member.open, {
                        email: member.fullName ?? member.email,
                      })}
                      className="flex flex-wrap items-start justify-between gap-3 p-4 hover:bg-field"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-text">
                          {/*
                            The NAME identifies the person, and the address falls back when nobody
                            has typed one (Bashar, 2026-08-23 — he was reading a record that said
                            `staff12@safra.test`). Not «بلا اسم» here: on a list you are scanning to
                            find somebody, an address identifies them and a placeholder does not.
                            The record says «بلا اسم», because there the question is whether the
                            field is set.
                          */}
                          {member.fullName ?? <Ltr>{member.email}</Ltr>}
                          {/*
                            Your own row, marked. It costs one session read the page already had,
                            and without it the only way to find yourself in a list of colleagues is
                            to recognise your own address — which is exactly the moment somebody
                            suspends the wrong account.
                          */}
                          {member.id === session?.user.id ? (
                            <span className="text-faint"> {t.sections.staff.you}</span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {/* The address stays visible once a name displaces it — two people share
                              a name long before they share a mailbox. */}
                          {member.fullName ? (
                            <>
                              <Ltr>{member.email}</Ltr> ·{' '}
                            </>
                          ) : null}
                          {member.staffRoleName ?? roleName(member.role)} ·{' '}
                          {member.lastLoginAt
                            ? fill(t.sections.staff.lastSignIn, {
                                when: shortDate(member.lastLoginAt),
                              })
                            : t.sections.staff.neverSignedIn}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {member.invitationPending ? (
                          <Pill tone="gold">{t.sections.staff.invitationPending}</Pill>
                        ) : null}
                        {!member.twoFactorEnabled && !member.invitationPending ? (
                          <Pill tone="gold">{t.sections.staff.twoFactorMissing}</Pill>
                        ) : null}
                        {member.status === 'suspended' ? (
                          <Pill tone="bad">{t.sections.staff.suspended}</Pill>
                        ) : null}
                      </div>
                    </a>
                  </li>
                ))}
              </ul>

              {/*
                Paged like every other registry (Bashar, 2026-08-05). This table used to render
                every staff account in one response — 165 rows on the development database, and
                growing with the company.
              */}
              <TablePagination
                basePath="/staff"
                section="staff"
                /* No second table on this page any more, so nothing to carry forward. */
                query={{}}
                page={result.page}
                pages={result.pages}
                total={result.total}
                capped={result.capped}
                size={size}
                label={fill(t.table.paginationLabelOf, {
                  section: t.sections.staff.listLabel,
                })}
              />
            </div>
          )}

          <FootNote>{t.sections.staff.note}</FootNote>
        </ConsolePanel>

        {/*
          Last on the page, under the people and their pager.

          A failed overview loses the PANEL, not the page — the same handling the counters use
          above. الموظفون exists to show who works here; it must not refuse to do that because a
          secondary read came back empty.
        */}
        <Activity
          result={activityPage}
          term={activityTerm}
          size={activity.size}
          carry={{ page: String(page), size: String(size) }}
        />
      </div>
    </ConsoleShell>
  );
}

/**
 * آخر نشاط الموظفين — searchable, capped in height, and paged.
 *
 * From the audit log, not a separate feed: there is exactly one record of what staff did, it is
 * append-only by trigger, and a second store would be a second version of the truth. The API builds
 * this and سجل التدقيق from one query, so the same event cannot read differently on the two screens.
 *
 * ## Paged rather than lazily loaded
 *
 * Bashar offered either (2026-08-24). Paged, because his own standing instruction is that every
 * console list carries a page NUMBER the reader chooses and a rows-per-page they choose, and an
 * infinite list has neither. The max height he asked for is a separate requirement and they compose:
 * the rows scroll INSIDE their own box, which is what the responsive rule requires of any tall
 * content, and the pager sits under the box rather than inside the scroll.
 *
 * ## The search is a GET form
 *
 * A search reads; it must be shareable, reload-safe and back-button-safe, and a POST is none of
 * those. It carries the accounts registry's page and size as hidden fields so searching the activity
 * does not move the reader's place in the list above it.
 */
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

function Activity({
  result,
  term,
  size,
  carry,
}: {
  result: Awaited<ReturnType<typeof getStaffActivity>>;
  term: string | undefined;
  size: number;
  /** The OTHER table's position, carried so one pager cannot move the other. */
  carry: Record<string, string>;
}) {
  return (
    <ConsolePanel title={t.sections.staff.activity}>
      <form method="get" action="/staff" className="mb-3 flex flex-wrap gap-2">
        {Object.entries(carry).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        {/* The size survives a search; the page deliberately does not — a new search starts at one. */}
        <input type="hidden" name="activitySize" value={String(size)} />
        <input
          type="search"
          name="activityQ"
          defaultValue={term ?? ''}
          placeholder={t.sections.staff.activitySearch}
          aria-label={t.sections.staff.activitySearchLabel}
          /* No `dir`: a field a person types into follows the page (docs/i18n.md §9). */
          className="min-w-0 flex-1 rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
        />
        <button
          type="submit"
          className="inline-flex min-h-10 cursor-pointer items-center rounded-[9px] border border-line px-4 py-2 text-[12.5px] text-muted hover:border-gold/50 hover:text-gold lg:min-h-0"
        >
          {t.sections.staff.activitySearchGo}
        </button>
        {term ? (
          <a
            href={`/staff?${new URLSearchParams({ ...carry, activitySize: String(size) }).toString()}`}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-[9px] border border-line px-4 py-2 text-[12.5px] text-muted hover:border-gold/50 hover:text-gold lg:min-h-0"
          >
            {t.sections.staff.activityClear}
          </a>
        ) : null}
      </form>

      {result === 'unauthenticated' ? (
        <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
      ) : result === 'failed' ? (
        <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
      ) : result.items.length === 0 ? (
        /*
          A search that matched nobody says so. It must NOT say «لا نشاط بعد»: the reader typed a
          colleague's name, and being told there is no activity would have them believe that person
          has done nothing rather than that the term found no one.
        */
        <p className="text-[12.5px] text-faint">
          {term ? t.sections.staff.activityNoMatch : t.dashboard.nothingWaiting}
        </p>
      ) : (
        <>
          {/*
            Capped and scrolled in its own box — Bashar's max height. `overscroll-contain` so
            reaching the end of this list does not carry on scrolling the page underneath it.
          */}
          <ul className="grid max-h-[26rem] gap-2.25 overflow-y-auto overscroll-contain pe-1 text-[12.5px]">
            {result.items.map((row) => (
              <li key={row.id}>
                <a
                  href={`/staff/activity/${row.id}${returnQuery({ page: result.page, size })}`}
                  aria-label={t.sections.staff.activityOpen}
                  className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-line bg-field px-3.25 py-2.5 hover:border-gold/50"
                >
                  <span className="font-bold text-text">
                    {row.actorEmail ?? t.admin.systemActor}
                  </span>
                  <span className="text-text2">{auditAction(row.action)}</span>
                  <span className="text-[11px] text-faint">
                    {auditSubject(row.subjectType)}
                  </span>
                  <Ltr className="ms-auto text-[11px] text-faint">
                    {shortDateTime(row.createdAt)}
                  </Ltr>
                </a>
              </li>
            ))}
          </ul>

          <TablePagination
            basePath="/staff"
            section="staffActivity"
            query={{ ...carry, ...(term ? { activityQ: term } : {}) }}
            page={result.page}
            pages={result.pages}
            total={result.total}
            capped={result.capped}
            size={size}
            label={fill(t.table.paginationLabelOf, {
              section: t.sections.staff.activity,
            })}
          />
        </>
      )}
    </ConsolePanel>
  );
}

function Pill({ tone, children }: { tone: 'gold' | 'bad'; children: React.ReactNode }) {
  const classes =
    tone === 'bad'
      ? 'border-bad/40 bg-bad/10 text-bad'
      : 'border-gold/40 bg-gold/10 text-gold';

  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${classes}`}>
      {children}
    </span>
  );
}
