-- ============================================================================
-- SAFRA — finding the gift cards that have just expired, cheaply.
--
-- Idempotent, like the rest of the post/ stage.
-- ============================================================================
--
-- `gift-card-expiry` runs every hour and asks one question: which ACTIVE cards
-- have an `expires_at` in the past. The ordinary answer is none, and rule 2
-- forbids paying for a full scan to learn that on a table that only grows.
--
-- PARTIAL, over exactly the rows the sweep can act on. A card that is `used`,
-- `cancelled` or already `expired` is never a candidate, and neither is one with
-- no expiry at all — a gift card without `expires_at` does not expire, which is a
-- product decision the schema already allows by making the column nullable.
--
-- The index therefore holds only live, dated cards, and shrinks as they are
-- retired. Ordered by `expires_at` so the sweep's ORDER BY is served by the same
-- index it uses to find them: the oldest expiry first, which is the batch that
-- has been wrong on screen for longest.

CREATE INDEX IF NOT EXISTS gift_cards_due_to_expire_idx
  ON gift_cards (expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;
