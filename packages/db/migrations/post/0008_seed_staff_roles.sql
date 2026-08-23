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
INSERT INTO staff_roles (name, permissions, admits_as, is_system)
VALUES
  ('مدير عام',      ARRAY[]::text[], 'super_admin',        true),
  ('مدير العمليات', ARRAY[]::text[], 'operations_manager', false),
  ('مسؤول مالي',    ARRAY[]::text[], 'finance_officer',    false),
  ('وكيل الدعم',    ARRAY[]::text[], 'support_agent',      false)
ON CONFLICT DO NOTHING;
