-- ============================================================================
-- SAFRA — guarantees for property photographs (§5.6 gallery, §7.2 management).
--
-- Idempotent, like the rest of the post/ stage.
-- ============================================================================

-- ── Exactly one cover ───────────────────────────────────────────────────────
--
-- The cover is what every search card, every booking confirmation and the
-- partner's own listing card render. Two of them is not a display quirk: which
-- one appears becomes whichever row the planner returns first, so the same
-- listing shows different photographs on different pages.
--
-- A PARTIAL index, over live images only. An archived image keeps its
-- `is_cover` value as a record of what the listing looked like at the time, and
-- a plain unique index would make archiving a cover impossible without first
-- clearing the flag — losing that record.
CREATE UNIQUE INDEX IF NOT EXISTS property_images_one_cover
  ON property_images (property_id)
  WHERE is_cover = true AND deleted_at IS NULL;

-- ── Order is a position, not an opinion ─────────────────────────────────────
SELECT add_constraint_if_missing('property_images', 'property_images_sort_order_natural',
  'CHECK (sort_order >= 0)');

-- ── Dimensions, when present, are real ──────────────────────────────────────
--
-- Nullable because a legacy row may predate the processing pipeline; a value
-- that IS there must be usable, since the frontend divides by it to hold the
-- aspect ratio and a zero would be a division by zero in somebody's browser.
SELECT add_constraint_if_missing('property_images', 'property_images_dimensions_positive', $def$
  CHECK (
    (width IS NULL OR width > 0) AND (height IS NULL OR height > 0)
  )
$def$);
