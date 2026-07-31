-- How much of a refund went back to the customer's wallet rather than out through
-- the gateway (§7.3).
--
-- Bounds the next partial refund: stored value is returned first, so without this
-- a second refund on the same booking would have no way to know the wallet portion
-- was already settled and would return it twice.
--
-- Defaults to 0, which is correct for every existing row — split payment did not
-- exist before this migration, so every refund so far was entirely provider-side.
ALTER TABLE "refunds" ADD COLUMN "wallet_amount" numeric(14, 2) DEFAULT '0' NOT NULL;
