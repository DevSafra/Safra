-- Three currencies, and only three: SYP, USD, EUR (Bashar, 2026-08-30).
--
-- JOD and LBP were seeded and neither could ever price anything. `fx_rates` holds exactly one
-- pair — USD -> SYP — and `rateBetween` REFUSES rather than defaulting to 1 for a pair it cannot
-- reach, which is the correct behaviour and makes an unrateable currency an offer the platform
-- declines to honour. A Jordanian visitor met «الأردن · JOD» on the geography screen and a
-- booking that could not be quoted.
--
-- RETIRED, not deleted. Nothing referenced LBP at all and JOD only through Jordan's display
-- currency, so a DELETE would have worked here and would be the wrong habit: a currency id can
-- reach a booking, a wallet movement, a gift card and a ledger row, and none of those may lose
-- their unit because a market closed. `deleted_at` is how this platform stops offering something.

-- Jordan prices in USD, like Syria and Lebanon already do. Done FIRST: retiring the currency
-- underneath a country still pointing at it would leave a market displaying a currency the reads
-- filter out, which renders as «—» rather than as an error anybody would notice.
UPDATE countries
SET display_currency_id = (SELECT id FROM currencies WHERE code = 'USD'),
    updated_at = now()
WHERE code = 'JO'
  AND display_currency_id = (SELECT id FROM currencies WHERE code = 'JOD');

UPDATE currencies
SET deleted_at = now(), is_active = false, updated_at = now()
WHERE code IN ('JOD', 'LBP') AND deleted_at IS NULL;
