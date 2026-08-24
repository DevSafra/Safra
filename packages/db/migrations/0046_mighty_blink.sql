-- The words on a violation, which the partner could never read (Bashar, 2026-08-24).
--
-- `violationRaiseSchema` and `violationFineSchema` have always REQUIRED a reason, with a
-- twenty-character floor, and the console labels both fields «الوصف (يقرأه الشريك)» -- the
-- description, read by the partner. Both were written to `audit_log.reason` and nowhere else, so
-- the partner's own مخالفات screen could show only the kind, a stage, an occurrence number and a
-- figure. The platform accused a business of something and never told it what.
--
-- Both nullable: 7,679 rows predate them and there is nothing truthful to backfill. The audit log
-- HAS the prose for those rows, but moving it here would be a guess about which audit entry belongs
-- to which violation -- `subject_id` is the PARTNER, not the violation -- and inventing the link
-- would put words on a record an appeal is meant to trust. Old rows stay wordless and honest; the
-- screen says so rather than showing an empty line.

ALTER TABLE "partner_violations" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "partner_violations" ADD COLUMN "fine_reason" text;