-- Idempotent, because the post/ stage re-runs on every deploy — see migrate.ts.
--
-- The four roles that existed as enum values become ROWS, so they can be renamed and adjusted like
-- any other (Bashar, 2026-08-23: "do the same for its own employees").
--
-- `super_admin` is seeded with is_system, and that flag is the lockout guard: it cannot be renamed,
-- reduced or retired. Without it a super admin edits their own role, drops staff.manage, and nobody
-- is left who can put it back.
--
-- Permissions are seeded EMPTY on purpose, and the reason matters: what each of these four roles
-- can do still comes from ROLE_PERMISSIONS in code while users.staff_role_id is null. Copying the
-- sets into rows here would create a second source of truth that drifts silently the moment
-- somebody edits the code list. A role row governs only the accounts pointed at it.
--
-- ## Only into an EMPTY table (2026-10-06)
--
-- `ON CONFLICT DO NOTHING` was the only guard, and the conflict it can see is a LIVE row with the
-- same name — the unique index is `lower(name)` over rows that are not deleted. So the roles staff
-- were told they could rename and retire came back on the next deploy: retire «وكيل الدعم» and it
-- was inserted again, rename it «الدعم» and the original name returned beside it as a second role.
-- A deploy undid a decision the console had recorded, with no audit row saying so.
--
-- These four are the STARTING set, which is a property of the table rather than of each row. Any
-- row at all, retired ones included, means the set has been seeded and is now staff's to manage.
-- The system role cannot be lost that way: it cannot be renamed, reduced or retired.
INSERT INTO staff_roles (name, permissions, admits_as, is_system)
SELECT v.name, ARRAY[]::text[], v.admits_as::user_role, v.is_system
FROM (VALUES
  ('مدير عام',      'super_admin',        true),
  ('مدير العمليات', 'operations_manager', false),
  ('مسؤول مالي',    'finance_officer',    false),
  ('وكيل الدعم',    'support_agent',      false)
) AS v(name, admits_as, is_system)
WHERE NOT EXISTS (SELECT 1 FROM staff_roles)
ON CONFLICT DO NOTHING;
