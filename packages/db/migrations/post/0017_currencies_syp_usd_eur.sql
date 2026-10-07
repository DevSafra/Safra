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

-- ## Once, and never over a decision made since (2026-10-06)
--
-- Both statements used to run on every deploy, and the console can undo each of them: the
-- geography screen reinstates a retired currency code, and sets a country's display currency.
-- So JOD added back by staff was retired again by the next deploy, and Jordan moved back to USD,
-- with nothing in the audit log to say why.
--
-- The guard is the row's own `updated_at`, which `touch_updated_at` moves on every edit. This file
-- was written on 2026-08-30, so a row last touched before 2026-08-31 is one it has never seen, and
-- a row touched since is one somebody, or this file's first run, has already decided about. That
-- keeps the one database that needs it, one older than the file, correct, and leaves every other
-- database exactly as it is. A ledger of applied files would have the same effect and needs a
-- table for it.

-- Jordan prices in USD, like Syria and Lebanon already do. Done FIRST: retiring the currency
-- underneath a country still pointing at it would leave a market displaying a currency the reads
-- filter out, which renders as «—» rather than as an error anybody would notice.
UPDATE countries
SET display_currency_id = (SELECT id FROM currencies WHERE code = 'USD'),
    updated_at = now()
WHERE code = 'JO'
  AND display_currency_id = (SELECT id FROM currencies WHERE code = 'JOD')
  AND updated_at < '2026-08-31T00:00:00Z'::timestamptz;

UPDATE currencies
SET deleted_at = now(), is_active = false, updated_at = now()
WHERE code IN ('JOD', 'LBP') AND deleted_at IS NULL
  AND updated_at < '2026-08-31T00:00:00Z'::timestamptz;
