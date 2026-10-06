-- Coupons that predate the partner opt-in are treated as ACCEPTED, once.
--
-- From 2026-09-01 a coupon does nothing until the partner takes it up (Bashar): every eligible
-- partner is offered it, and `CouponService` refuses a booking whose partner has not accepted.
--
-- Applied to an existing database that rule would silently switch off every live coupon — the
-- codes are unchanged, the windows are unchanged, and checkout starts answering «this coupon is
-- not for this partner» to customers holding a code that worked yesterday. Nothing in the console
-- would show why, because the coupon still reads «نشط».
--
-- So every coupon that already existed is backfilled as accepted by everyone it was scoped to,
-- which preserves exactly that day's behaviour. The offer flow governs everything after it.
--
-- ## A one-off, and why that needed saying twice (2026-10-06)
--
-- Every post/ file runs on every deploy. This one used to rely on `ON CONFLICT DO NOTHING` alone,
-- which protects a decision a partner has MADE but not one they have yet to make: each deploy
-- inserted `accepted` for every live coupon × approved partner pair with no row, so a partner
-- approved last week was signed up to every live discount by the next deploy, without being asked.
-- That is the rule this file exists to protect, broken by the file.
--
-- Two guards, because either alone leaves a hole:
--
--   * The MARKER (the pattern 0021 set): once the backfill has run it never runs again.
--   * The DATES: only coupons created, and partners approved, before 2026-09-01. A database where
--     the unguarded version already ran meets this file for the first time without a marker, and
--     the marker alone would let that first run enrol everyone approved since. Anything from
--     2026-09-01 on was created under the offer flow and is the offer flow's to decide.
CREATE TABLE IF NOT EXISTS coupon_partners_backfill (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  rows_accepted bigint NOT NULL,
  completed_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE coupon_partners_backfill IS
  'One row: the moment pre-opt-in coupons were backfilled as accepted. Its presence is what stops post/0020 enrolling partners on every deploy.';

DO $$
DECLARE
  accepted bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM coupon_partners_backfill) THEN
    RAISE NOTICE 'coupon partners backfill: already done, skipping';
    RETURN;
  END IF;

  INSERT INTO coupon_partners (coupon_id, partner_id, status, decided_at)
  SELECT c.id, p.id, 'accepted', now()
  FROM coupons c
  JOIN partners p
    ON p.verification = 'approved'
   AND p.deleted_at IS NULL
   AND coalesce(p.verified_at, p.created_at) < '2026-09-01T00:00:00Z'::timestamptz
   AND (c.city_id IS NULL OR p.city_id = c.city_id)
   AND (c.partner_id IS NULL OR p.id = c.partner_id)
  WHERE c.deleted_at IS NULL
    AND c.created_at < '2026-09-01T00:00:00Z'::timestamptz
  ON CONFLICT (coupon_id, partner_id) DO NOTHING;

  GET DIAGNOSTICS accepted = ROW_COUNT;

  INSERT INTO coupon_partners_backfill (rows_accepted) VALUES (accepted);

  RAISE NOTICE 'coupon partners backfill: % pairs accepted', accepted;
END $$;
