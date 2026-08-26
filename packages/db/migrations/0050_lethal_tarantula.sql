-- SAFRA — the expense behind a gift card SAFRA gives away.
--
-- `gift_card_redemption` is the LIABILITY a live card represents; this is the other
-- side of the entry when staff issue one for nothing. Keeping them apart is the
-- point of an account: a giveaway and a service-failure payment are different cost
-- lines, and «what did we give away this month» should not mean reading
-- descriptions. Enum values cannot be removed in PostgreSQL, so this is one-way.

ALTER TYPE "public"."ledger_account" ADD VALUE 'gift_card_issued';