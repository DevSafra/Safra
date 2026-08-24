import { getAssignableStaffPermissions, getStaffRoles } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { StaffRolesManager } from '@/components/staff-roles-manager';
import { FootNote } from '@/components/admin-table';
import { t } from '@/lib/strings';
import { refuseSection } from '@/components/section-refusal';

/**
 * أدوار موظفي الشركاء — the super admin defines and names them (Bashar, 2026-08-23).
 *
 * The case Bashar described is a reception employee who takes bookings for clients. Roles are
 * GLOBAL: named here once and chosen from by every partner, rather than each partner inventing
 * their own. That is what "the super admin should define the employee roles himself and name them"
 * means, and it is also the only arrangement where the capability allow-list has one owner.
 *
 * ## Why this list is not paginated, and why that is not an omission
 *
 * `TablePagination` is required on every paged list, with one documented exception in
 * `.claude/CLAUDE.md`: bounded REFERENCE data, where the screen exists to show the complete set.
 * These roles are that — the same shape as `partner_types` and the geography screen's three lists.
 * A super admin naming a new role needs to see every role that already exists, «صفحة ١ من ١» over
 * four rows teaches nobody anything, and `GET /admin/staff-roles` deliberately returns them
 * whole rather than by page.
 *
 * The rule is explicit that an exception must be ENFORCED rather than trusted, so
 * `staff-roles-bounds.integration.test.ts` fails if the set outgrows a screen and names the work.
 * Without that test this comment would be a hope.
 *
 * ## A failed read renders the screen, not a blank
 *
 * `assignable` failing means an empty checkbox list, which is honest — the form cannot offer a
 * capability it could not confirm the API accepts. It is not a reason to hide the roles that exist.
 */
export const dynamic = 'force-dynamic';

export default async function StaffRolesPage() {
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never
    runs: the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and
    signing in again lands them here again.
  */
  const refused = await refuseSection('staffRoles', t.nav.staffRoles);

  if (refused) return refused;

  const [roles, assignable, counts] = await Promise.all([
    getStaffRoles(),
    getAssignableStaffPermissions(),
    sidebarCounts(),
  ]);

  const unauthenticated = roles === 'unauthenticated' || assignable === 'unauthenticated';

  return (
    <ConsoleShell
      title={t.nav.staffRoles}
      subtitle={t.sections.staffRoles.subtitle}
      counts={counts}
    >
      <ConsolePanel title={t.sections.staffRoles.title}>
        {unauthenticated ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : roles === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <StaffRolesManager
            roles={roles.roles}
            /*
              Only `'failed'` is tested here. `unauthenticated` above already covers the other
              case, and TypeScript narrows from it — a second `=== 'unauthenticated'` is provably
              dead and the compiler says so, which is the compiler being more useful than a
              defensive habit.
            */
            assignable={assignable === 'failed' ? [] : assignable.permissions}
          />
        )}

        <FootNote>{t.sections.staffRoles.scopeNote}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}
