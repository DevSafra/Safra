-- The four enum members become rows, and every city's array becomes links.
--
-- `city_category` was a pgEnum, so «manage the categories» meant a migration and a deployment
-- rather than a screen — the one reference set on this platform that was not already a table.
-- Bashar asked for the page on 2026-08-30.
--
-- The enum and the array COLUMN both stay. A Postgres enum cannot lose a member while a column
-- still holds it, and `cities.categories` is read by the customer city page, the home page's
-- category strip, `catalog.service` and the geography screen. `GeoCategoryService` writes both,
-- and the array remains the read path until those callers move — recorded in FUTURE-WORK.

INSERT INTO city_categories (code, name_ar, name_en, name_de, sort_order)
VALUES
  ('coastal',  'ساحلية',   'Coastal',  'Küste',      1),
  ('mountain', 'جبلية',    'Mountain', 'Berge',      2),
  ('desert',   'صحراوية',  'Desert',   'Wüste',      3),
  ('historic', 'تاريخية',  'Historic', 'Historisch', 4)
ON CONFLICT (code) DO NOTHING;

-- Every city already filed under a category gets the matching link. `unnest` over the array is
-- what makes this exact rather than a guess: a city carrying two members produces two rows.
INSERT INTO city_category_links (city_id, category_id)
SELECT c.id, cc.id
FROM cities c
CROSS JOIN LATERAL unnest(c.categories) AS member(code)
JOIN city_categories cc ON cc.code = member.code::text
WHERE c.deleted_at IS NULL
ON CONFLICT DO NOTHING;
