-- ============================================================================
-- SAFRA — a listing has ONE cover image, and the database is what says so.
--
-- Idempotent, like the rest of the post/ stage.
-- ============================================================================
--
-- `property_images.is_cover` was a plain boolean with nothing stopping several
-- rows of one property setting it. On 2026-08-26 seventy-two properties carried
-- more than one, and one carried five.
--
-- "The cover" is singular by definition — it is the image that leads the listing
-- in search results, on the property page and in the console's review screen.
-- With several set, which one leads is whatever order a query happened to
-- return, so the same listing could present differently on two screens and a
-- partner's own choice was not honoured on either.
--
-- Bashar (2026-08-26): the cover is the property owner's decision, and staff
-- display it rather than choose it. The console has no control for it and must
-- not grow one; this constraint is the half that cannot be forgotten.

-- ── 1. Backfill, deterministically ──────────────────────────────────────────
--
-- Keep the OLDEST cover — `created_at`, tie-broken by `id` so the result does
-- not depend on row order — and clear the flag from the rest. Oldest rather
-- than newest because it is the one the partner has been living with: whatever
-- their listing has looked like until now, it keeps looking like that.
--
-- Nothing is deleted. The other images stay exactly where they are and only
-- stop claiming to be the cover.

UPDATE property_images AS i
SET is_cover = false
WHERE i.is_cover
  AND i.deleted_at IS NULL
  AND i.id <> (
    SELECT keep.id
    FROM property_images AS keep
    WHERE keep.property_id = i.property_id
      AND keep.is_cover
      AND keep.deleted_at IS NULL
    ORDER BY keep.created_at, keep.id
    LIMIT 1
  );

-- ── 2. And it cannot happen again ───────────────────────────────────────────
--
-- A PARTIAL unique index: unique over `property_id` only among rows where the
-- flag is set. A plain unique on `(property_id, is_cover)` would also forbid a
-- property having two NON-cover images, which is every property.
--
-- `deleted_at IS NULL` is part of the predicate, and leaving it out broke
-- archiving immediately. Images are SOFT-deleted, an archived row keeps whatever
-- flag it had, and `archive()` promotes the next image when it removes the
-- cover — so an index over every row saw the archived cover and the promoted one
-- as two. The invariant is one cover among the images that EXIST; a soft-deleted
-- row is not one of them.
--
-- This is the whole point of doing it here rather than in a service. Two code
-- paths set a cover today — the partner's own image manager and the seed — and
-- a rule enforced by whichever of them you remembered is not a rule. A second
-- cover is now a write that fails.

DROP INDEX IF EXISTS property_images_one_cover_idx;

CREATE UNIQUE INDEX IF NOT EXISTS property_images_one_cover_idx
  ON property_images (property_id)
  WHERE is_cover AND deleted_at IS NULL;
