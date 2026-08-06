-- ============================================================================
-- SAFRA — backfill: cancellation reasons the PLATFORM wrote become codes.
--
-- Until 2026-08-06 the three cancellations this system decides for itself stored
-- an English SENTENCE in bookings.cancellation_reason. The Arabic-only staff
-- console has no way to translate prose, so every one of those bookings printed
-- "Payment not completed within the allowed window (EC-001)." under الإلغاء
-- (Bashar, 2026-08-06).
--
-- The write paths now store a `system.*` code and the reader's locale resolves
-- it. The renderer falls back to the raw value, so rows left holding English
-- still render — which is why the code change needed no migration. But "no
-- migration" also means every booking cancelled BEFORE that change keeps its
-- English forever, and on this console that is simply the bug, still on screen.
-- Hence this file.
--
-- ## Why this is safe to run on every deploy
--
-- It rewrites three EXACT strings — the literals the code used to write, quoted
-- here verbatim — to their codes. After the first run nothing matches, so it is
-- a no-op. It cannot touch a reason a person typed unless they typed one of
-- these three sentences character for character, which would be a reason with
-- the same meaning anyway.
--
-- ## Why not a Drizzle migration
--
-- Drizzle generates schema DDL from the schema file; this changes DATA and no
-- schema declaration describes it. The post/ stage is the hand-written,
-- idempotent, runs-last stage, which is exactly what a backfill needs.
-- ============================================================================

UPDATE bookings
SET cancellation_reason = 'system.payment_expired'
WHERE cancellation_reason = 'Payment not completed within the allowed window (EC-001).';

UPDATE bookings
SET cancellation_reason = 'system.partner_no_response'
WHERE cancellation_reason = 'Partner did not respond within the confirmation window (§6.4).';

UPDATE bookings
SET cancellation_reason = 'system.partner_rejected'
WHERE cancellation_reason = 'Rejected by partner.';
