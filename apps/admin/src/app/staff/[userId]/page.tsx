import { getGeography, getStaffMember, getStaffRoles } from '@/lib/api';
import { getStaffSession } from '@/lib/session-server';
import { sidebarCounts } from '@/lib/console';
import { shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { BackLink } from '@/components/back-link';
import { Ltr } from '@/components/admin-table';
import { StaffMemberActions } from '@/components/staff-member-actions';
import { StaffScopeEditor } from '@/components/staff-scope-editor';
import { backTarget } from '@/lib/search-params';
import { groupPermissions, isScopable, type Role } from '@safra/contracts';
import { fill, label, roleName, t } from '@/lib/strings';
import { refuseSection } from '@/components/section-refusal';

/**
 * صفحة الموظف — one staff member's record.
 *
 * Bashar, 2026-08-23: "Every Employee should be clickable to see his details." الموظفون had grown
 * six panels and a role select on every row; everything that describes ONE person moved here — what
 * their role is and what it can do, where they may work, whether they have accepted their
 * invitation, and the three controls that used to crowd the list.
 *
 * ## What the reader can trust on this screen
 *
 * `permissions` is resolved by the API through the same path `PermissionsGuard` uses. The console
 * does NOT compute it from the roles list it already holds, because that would make this screen a
 * second answer to "what can this role do" — and the direction a second answer fails in is the
 * dangerous one: telling somebody a colleague cannot reach payouts while the server lets them.
 */
export const dynamic = 'force-dynamic';

export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
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

  const { userId } = await params;
  const query = await searchParams;
  /*
    Built from the LITERAL '/staff', never from a path in the URL, and the row fragment is this
    screen's own id rather than a carried parameter — so a crafted link cannot turn «رجوع» into a
    redirect off the console or point it at a row the reader is not looking at.
  */
  const back = backTarget('/staff', query, userId);

  const [member, roles, geography, session, counts] = await Promise.all([
    getStaffMember(userId),
    getStaffRoles(),
    /*
      The complete city list, for the scope picker.

      Fetched whole rather than paged: geography is the documented bounded-reference-data exception
      and `geo-bounds.integration.test.ts` fails if it outgrows a screen. A failed read leaves the
      picker empty and says so — it must not take the record down with it.
    */
    getGeography(),
    getStaffSession(),
    sidebarCounts(),
  ]);

  if (member === 'unauthenticated' || member === 'failed') {
    return (
      <ConsoleShell title={t.sections.staff.member.heading} counts={counts}>
        <BackLink target={back} section={t.nav.staff} />
        <ConsolePanel>
          <p className="text-[12.5px] text-muted">
            {member === 'unauthenticated'
              ? t.dashboard.sessionExpired
              : t.sections.staff.member.notFound}
          </p>
        </ConsolePanel>
      </ConsoleShell>
    );
  }

  const isSelf = member.id === session?.user.id;

  return (
    <ConsoleShell title={t.sections.staff.member.heading} counts={counts}>
      <BackLink target={back} section={t.nav.staff} />

      {/* `mt-4`, the same separation every other detail screen gives it — see /partners. */}
      <div className="mt-4 grid gap-4">
        <ConsolePanel title={t.sections.staff.member.account}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Row term={t.sections.staff.member.colName}>
              {/*
                «بلا اسم» rather than the address, and this is the one surface where that is right.

                On the LIST the fallback is the email, because you are scanning to find somebody and
                an address identifies them. Here the question being asked is whether this account
                has a name, so a placeholder that reads as a STATE answers it and a repeated address
                does not.
              */}
              {member.fullName ?? (
                <span className="text-faint">{t.sections.staff.member.unnamed}</span>
              )}
            </Row>
            <Row term={t.sections.staff.member.colEmail}>
              {/*
                An address is a Latin RUN on a line of Arabic, so the VALUE is isolated and the
                label is not — wrapping the pair would render «البريد» after the address.
              */}
              <Ltr>{member.email}</Ltr>
              {isSelf ? (
                <span className="text-faint"> {t.sections.staff.you}</span>
              ) : null}
            </Row>
            <Row term={t.sections.staff.member.colRole}>
              {member.staffRoleName ?? roleName(member.role)}
            </Row>
            <Row term={t.sections.staff.member.colStatus}>
              {member.status === 'suspended'
                ? t.sections.staff.suspended
                : t.sections.staff.member.statusActive}
            </Row>
            <Row term={t.sections.staff.member.colAdded}>
              <Ltr>{shortDateTime(member.createdAt)}</Ltr>
            </Row>
            <Row term={t.sections.staff.member.colLastSignIn}>
              {member.lastLoginAt ? (
                <Ltr>{shortDateTime(member.lastLoginAt)}</Ltr>
              ) : (
                t.sections.staff.neverSignedIn
              )}
            </Row>
            <Row term={t.sections.staff.member.colTwoFactor}>
              <span className={member.twoFactorEnabled ? 'text-ok' : 'text-bad'}>
                {member.twoFactorEnabled
                  ? t.sections.staff.member.twoFactorOn
                  : t.sections.staff.member.twoFactorOff}
              </span>
            </Row>
            <Row
              term={t.sections.staff.scope}
              state={!isScopable(member.role as Role) ? 'not_scopable' : member.scopeKind}
            >
              {/*
                Three states, and the difference between the last two matters.

                A super admin is «غير قابل للتقييد» — not "all cities", because the scope machinery
                does not apply to them at all and saying "all cities" implies somebody could narrow
                it. For everybody else an EMPTY list means UNSCOPED, not "scoped to nowhere": the
                two readings are opposite and the wrong one is the permissive one, so it is said in
                words rather than left to an empty line.

                `isScopable` is the same predicate the API uses. The cast is the API boundary — the
                schema keeps `role` as a string on purpose, so a role added server-side renders
                rather than blanking the screen.
              */}
              {!isScopable(member.role as Role)
                ? t.sections.staff.scopeSuperAdmin
                : member.scopeCities.length === 0
                  ? t.sections.staff.scopeAllCities
                  : member.scopeCities.map((city) => city.name).join(' · ')}
            </Row>
          </dl>

          {/*
            Bashar's decision, 2026-08-04, and it moved here with the scope it describes.

            The note is not decoration: a scope that is DISPLAYED but not enforced is worse than no
            scope at all, so the screen commits to which it is. It also states that the audit log
            stays complete, because that is the one place an operator might reasonably assume scope
            applies and it deliberately does not.
          */}
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            {t.sections.staff.scopeNote}
          </p>

          {/*
            The editor, and ONLY where a scope can apply.

            A super admin is not scopable — `isScopable` says so and the API enforces it — so
            offering the form on their record would be a control whose every submission is refused.
            That is the one case where hiding a control is right rather than evasive: it is not
            "you may not", it is "there is nothing here to set".
          */}
          {isScopable(member.role as Role) ? (
            <div className="mt-4 border-t border-line2 pt-4">
              <h3 className="mb-2.5 text-[12.5px] font-bold text-gold">
                {t.sections.staff.scopeEdit}
              </h3>
              <StaffScopeEditor
                member={member}
                cities={
                  geography === 'failed' || geography === 'unauthenticated'
                    ? []
                    : geography.cities
                }
              />
            </div>
          ) : null}

          {member.staffRoleId === null ? (
            <p className="mt-3 text-[11.5px] text-warn">
              {t.sections.staff.member.noNamedRoleNote}
            </p>
          ) : null}
        </ConsolePanel>

        {/*
          الإجراءات sits DIRECTLY under الحساب (Bashar, 2026-08-23).

          He wrote "As a super admin, I should can change the state of the employee from نشط
          to غير نشط and change the role" — and both controls already existed, three panels
          down. His screenshot was cropped at the top of the page. He was not asking for a
          feature; he was telling us he could not find one, which is the more useful report.

          So: who they are, what you can do about it, then the detail. الصلاحيات is long and
          الدعوة is conditional; either one between the record and its controls buries them
          again.
        */}
        <ConsolePanel title={t.sections.staff.member.actions}>
          <StaffMemberActions
            member={member}
            roles={roles === 'failed' || roles === 'unauthenticated' ? [] : roles.roles}
            isSelf={isSelf}
          />
        </ConsolePanel>

        <ConsolePanel title={t.sections.staff.member.capabilities}>
          <p className="-mt-1 mb-3 text-[11.5px] text-faint">
            {t.sections.staff.member.capabilitiesHint}
          </p>

          {member.permissions.length === 0 ? (
            <p className="text-[12.5px] text-faint">
              {t.sections.staff.member.noCapabilities}
            </p>
          ) : (
            <div className="grid gap-3">
              {/*
                Grouped by domain, the same split the role form uses. Sixty-three capabilities in a
                flat column is a wall; the person reading this is answering "should they be able to
                do that", which is a question about areas of the business.
              */}
              {groupPermissions(member.permissions).map((entry) => (
                <div key={entry.group}>
                  <h3 className="text-[11px] font-bold text-faint">
                    {label(t.sections.staffRoles.group, entry.group)}
                  </h3>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-text2">
                    {entry.permissions
                      .map((permission) =>
                        label(t.sections.staffRoles.capability, permission),
                      )
                      .join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ConsolePanel>

        {member.invitationPending ? (
          <ConsolePanel title={t.sections.staff.member.invitation}>
            <p className="text-[12.5px] text-text2">
              {t.sections.staff.invitationPending}
              {member.invitationSentAt
                ? ` · ${fill(t.sections.staff.member.invitationSentAt, {
                    when: shortDateTime(member.invitationSentAt),
                  })}`
                : ''}
              {member.invitationExpiresAt
                ? ` · ${fill(t.sections.staff.member.invitationExpires, {
                    when: shortDateTime(member.invitationExpiresAt),
                  })}`
                : ''}
            </p>
          </ConsolePanel>
        ) : null}
      </div>
    </ConsoleShell>
  );
}

function Row({
  term,
  children,
  state,
}: {
  term: string;
  children: React.ReactNode;
  /*
    An optional machine-readable value for the browser suite.

    The النطاق row needs one: «كل المدن» is also the label of a radio in the editor below it, so a
    test searching the page for that string finds it whatever the scope is — my first assertion was
    exactly that vacuous check and it passed on a scope it should have failed. `data-state` names the
    STORED value, which is the thing under test. Same technique as `data-contract-status`.
  */
  state?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-faint">{term}</dt>
      <dd
        className="mt-0.5 text-[12.5px] text-text"
        {...(state ? { 'data-state': state } : {})}
      >
        {children}
      </dd>
    </div>
  );
}
