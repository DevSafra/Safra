-- Two dead test rows leave الإعدادات, and the one that must stay learns to speak Arabic.
--
-- Bashar, 2026-08-31, reading the settings screen: three rows on it were test fixtures —
-- `test.owned_by_pid_84194`, `test.owned_by_pid_84260` and `test.settings_admin_fixture`. He is
-- right that they do not belong in front of an operator, and the two halves of that have different
-- answers.
--
-- ## The `owned_by_pid` rows are residue, and they are deletable
--
-- They were made by an earlier version of `settings-admin.integration.test.ts`, which keyed its
-- fixture by PROCESS ID. That is the mistake the current test's docblock describes and avoids: a
-- per-run key leaves a new permanent row behind on every run, because `settings_history` holds a
-- foreign key to `settings.id` and is append-only by trigger, so any setting that has ever been
-- EDITED can never be removed. Nothing creates these two any more (`grep -rn owned_by_pid` finds
-- only a unit-test string), and neither has a single history row — so unlike the fixture below,
-- they really can go.
--
-- Guarded on the absence of history rather than trusting the observation: if a row somehow has one,
-- the delete skips it instead of failing the deploy on a foreign key.
DELETE FROM settings
WHERE key LIKE 'test.owned_by_pid_%'
  AND scope = 'global'
  AND NOT EXISTS (
    SELECT 1 FROM settings_history h WHERE h.setting_id = settings.id
  );

-- ## The remaining fixture stays, and says what it is in the reader's language
--
-- `test.settings_admin_fixture` has 42 history rows and is permanent by design — the test keeps ONE
-- stable key precisely so that only one such row can ever exist. It carried an English
-- `description_en` and no `description_ar`, so الإعدادات fell back to showing its KEY as its label:
-- an operator met `test.settings_admin_fixture` with no explanation at all.
--
-- The screen labels a setting from `@safra/i18n` now, with the database description as the
-- fallback. This fills the fallback in, because the row is created by a test rather than seeded —
-- so the catalogue is the wrong home for it, and «test fixtures» is a documented exception to the
-- copy rule. What is NOT excusable is it reaching a screen in English.
UPDATE settings
SET description_ar =
      'صف اختباري يستخدمه فحص محرر الإعدادات. لا يقرأه أي كود، ولا يؤثر تغييره على شيء.'
WHERE key = 'test.settings_admin_fixture'
  AND scope = 'global'
  AND description_ar IS NULL;

-- ## Two SEEDED descriptions carried the same fault, and the seed is not re-run
--
-- `settings` is seeded once and never truncated, so correcting `src/seed/reference.ts` reaches a
-- fresh database and no existing one. Both of these were on the screen Bashar was reading:
--
--   * the payment-timeout row said «مهلة Pending Payment …» — an English status name inside an
--     Arabic label;
--   * the confirmation-window row said «مهلة تأكيد الشريك (ساعتان)» — a label stating the CURRENT
--     VALUE, which becomes false the moment somebody sets 180 minutes, and which the screen now
--     prints beside it anyway as «120 دقيقة».
--
-- Only overwritten where the value is still the old one, so a description somebody has since edited
-- by hand is left alone.
UPDATE settings
SET description_ar = 'مهلة انتظار الدفع — يُلغى الحجز تلقائياً إن لم يكتمل'
WHERE key = 'booking.pending_payment_timeout_minutes'
  AND scope = 'global'
  AND description_ar = 'مهلة Pending Payment — يلغى الحجز تلقائياً إن لم يكتمل الدفع';

UPDATE settings
SET description_ar = 'مهلة الشريك لتأكيد الحجز'
WHERE key = 'booking.confirmation_window_minutes'
  AND scope = 'global'
  AND description_ar = 'مهلة تأكيد الشريك (ساعتان)';
