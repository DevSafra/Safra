-- ============================================================================
-- SAFRA — what the renderer actually produced for a piece of dispute evidence.
--
-- Idempotent, like the rest of the post/ stage.
-- ============================================================================
--
-- Evidence is APPEND-ONLY by design: created_at and no updated_at, no
-- deleted_at, because «evidence that can be edited or removed after the fact is
-- not evidence». This column does not weaken that. It records what the image
-- pipeline WROTE, not anything a person said, and it is written once by the
-- worker that rendered the file.
--
-- It is needed because the pipeline never upscales. A 640px photograph yields
-- variants at 400 and 640 and no 800, so a URL that asks for a fixed width
-- addresses an object that was never written -- a 404, naturalWidth zero, a
-- broken image on a row that looks fine. That defect shipped once already on ad
-- creatives (2026-08-27); storing the widths is how the URL can ask for one
-- that exists.
--
-- NULL therefore means «not rendered yet», which is also the only status this
-- table needs: a row exists the moment the bytes are stored, and the picture
-- appears when the worker has finished with it.

ALTER TABLE dispute_evidence
  ADD COLUMN IF NOT EXISTS variant_widths integer[];
