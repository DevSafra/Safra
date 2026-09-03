import { getAssignableCapabilities, getMyEmployeeRoles, sidebarBadges } from '@/lib/api';
import { isEmployeeReader, requireVerifiedPartner } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { EmployeeRoleManager } from '@/components/employee-role-manager';
import { t } from '@/lib/strings';

/**
 * أدوار الموظفين — the roles a PARTNER defines for their own staff (Bashar, 2026-08-23).
 *
 * ## Two role systems, not one
 *
 * SAFRA's own staff roles are the super admin's, on the console. THESE are the partner's, scoped to
 * them, and the two never meet: «استقبال» defined by one business says nothing about another, which
 * is why the unique index is `(partner_id, lower(name))` rather than global. A first-come global
 * namespace would have handed the obvious names to whoever registered first and permanently denied
 * them to everybody else — and told each of them that somebody already had it, which is a business's
 * internal structure leaking through a form.
 *
 * ## Whatever a partner ticks, an employee cannot exceed a partner
 *
 * The checkboxes are built from `GET .../assignable`, which serves `PARTNER_EMPLOYEE_PERMISSIONS` —
 * the same constant the API validates a submission against, and the same one `employeePermissions()`
 * intersects with when a token is built. So the bound holds in three places and the weakest link is
 * not this screen: a capability smuggled past the form is refused at the write, and one smuggled
 * past the write still resolves to nothing at the read.
 *
 * ## The empty state is the screen's real job
 *
 * A partner arriving here has never met the concept — they have had one login until today — and
 * they cannot invite anybody until a role exists. «أنشئ دورًا» over a blank page explains nothing,
 * so the empty state says what a role IS and offers an example of the right SHAPE of thought
 * ("a job, not a person") before asking for a name.
 *
 * Nothing is seeded. Suggesting «استقبال» and «محاسب» as one-click starters was the obvious
 * alternative and is worse: it writes SAFRA's guess about somebody's staffing into their account as
 * real rows they must then audit, and a role nobody chose is one nobody remembers granting.
 */
export const dynamic = 'force-dynamic';

export default async function EmployeeRolesPage() {
  /*
    An EMPLOYEE is told this belongs to the owner before either fetch is made — the same shape as
    الموظفون and `/payouts`. `PARTNER_EMPLOYEE_MANAGE` is deliberately absent from the employee
    allow-list: somebody who could define roles could define one for themselves.
  */
  const [employee, profile] = await Promise.all([
    isEmployeeReader(),
    requireVerifiedPartner(),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  const shell = (children: React.ReactNode) => (
    <Shell
      title={t.employeeRoles.title}
      partnerName={name}
      active="employeeRoles"
      badges={sidebarBadges(profile)}
    >
      <div className="grid gap-5">{children}</div>
    </Shell>
  );

  if (employee) {
    return shell(
      <p className="text-sm leading-relaxed text-muted">{t.employees.ownerOnly}</p>,
    );
  }

  const [rolesResult, capabilitiesResult] = await Promise.all([
    getMyEmployeeRoles(),
    getAssignableCapabilities(),
  ]);

  if (rolesResult === 'unauthenticated' || capabilitiesResult === 'unauthenticated') {
    return shell(<p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>);
  }

  if (rolesResult === 'failed' || capabilitiesResult === 'failed') {
    return shell(<p className="text-sm text-bad">{t.employeeRoles.loadFailed}</p>);
  }

  const roles = rolesResult.roles;

  return shell(
    <>
      <p className="text-[12.5px] leading-relaxed text-muted">{t.employeeRoles.intro}</p>

      {/*
        The teaching block, above the form and only when there is nothing yet. Once a role exists
        the reader has met the concept and the paragraph is in their way.
      */}
      {roles.length === 0 ? (
        <div className="grid gap-1.5 rounded-card border border-line bg-card p-4">
          <p className="text-sm font-semibold text-text">{t.employeeRoles.emptyTitle}</p>
          <p className="text-[12.5px] leading-relaxed text-muted">
            {t.employeeRoles.emptyBody}
          </p>
        </div>
      ) : null}

      <EmployeeRoleManager roles={roles} capabilities={capabilitiesResult.permissions} />
    </>,
  );
}
