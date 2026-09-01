-- Coupons that predate the partner opt-in are treated as ACCEPTED.
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
-- which preserves exactly today's behaviour. The offer flow governs coupons created from now on.
--
-- Idempotent: `ON CONFLICT DO NOTHING` on the composite key, so re-running adds nothing and
-- cannot overwrite a decision a partner has since made.
INSERT INTO coupon_partners (coupon_id, partner_id, status, decided_at)
SELECT c.id, p.id, 'accepted', now()
FROM coupons c
JOIN partners p
  ON p.verification = 'approved'
 AND p.deleted_at IS NULL
 AND (c.city_id IS NULL OR p.city_id = c.city_id)
 AND (c.partner_id IS NULL OR p.id = c.partner_id)
WHERE c.deleted_at IS NULL
ON CONFLICT (coupon_id, partner_id) DO NOTHING;
