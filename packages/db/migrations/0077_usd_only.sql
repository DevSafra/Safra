-- One currency is offered, and it is the dollar (Bashar, 2026-09-14).
--
-- «Remove all currencies from the system and keep only USD for everything.» `is_active` is what the
-- public `/currencies` endpoint answers with, so this is the switch that makes the platform
-- single-currency to everybody outside it.
--
-- NOTHING IS DELETED. P-003 forbids it and the references are real:
--
--   * SYP is the ACCOUNTING currency. Every ledger leg carries `amount_syp` and `fx_rate_to_syp`
--     beside its own amount, because SAFRA books in Syrian pounds whatever it prices in. Retiring
--     the row would orphan the basis of all 41,814 bookings already recorded. It stops being
--     OFFERED; it does not stop being the unit the books are kept in.
--   * EUR priced nothing — zero units — and `fx_rates` holds one pair, USD→SYP, so a euro figure
--     could only ever have been invented from no rate. It is retired the way JOD and LBP were in
--     `0017_currencies_syp_usd_eur.sql`: `deleted_at` set, row intact.
--   * TRY already carried `deleted_at` and was still flagged active, which is how it reached the
--     header's picker and then failed to convert. The flag is corrected here.
UPDATE currencies
   SET is_active = false, deleted_at = now(), updated_at = now()
 WHERE code = 'EUR' AND deleted_at IS NULL;--> statement-breakpoint

UPDATE currencies
   SET is_active = false, updated_at = now()
 WHERE code <> 'USD' AND is_active;--> statement-breakpoint

/*
  And the dollar is definitely on. A migration that only turns things off would leave a database
  where somebody had deactivated USD with nothing offered at all.
*/
UPDATE currencies
   SET is_active = true, deleted_at = NULL, updated_at = now()
 WHERE code = 'USD' AND (NOT is_active OR deleted_at IS NOT NULL);
