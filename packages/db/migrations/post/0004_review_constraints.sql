-- ============================================================================
-- SAFRA — guarantees for guest reviews (design handoff §7.3, P-006).
--
-- P-006 says a review cannot be deleted. That is a rule about the DATA, so it
-- lives here rather than in a service somebody can call a different way.
--
-- Idempotent, like the rest of the post/ stage.
-- ============================================================================

-- ── A score is a score ──────────────────────────────────────────────────────
--
-- `properties.rating` feeds the search ranking at the heaviest weight in the
-- model, so a rating outside 1–5 is not a display bug — it moves a listing up
-- the results for everybody.
SELECT add_constraint_if_missing('reviews', 'reviews_rating_range',
  'CHECK (rating BETWEEN 1 AND 5)');

-- A review with no words is a rating pretending to be a review.
SELECT add_constraint_if_missing('reviews', 'reviews_body_present',
  'CHECK (length(btrim(body)) >= 3)');

-- ── State and its evidence must agree ───────────────────────────────────────
--
-- Each of these is a lie the table could otherwise tell: a hidden review with
-- nobody accountable for hiding it, a report with no reason, a reply with no
-- timestamp. Every one would be read by a person as fact.
SELECT add_constraint_if_missing('reviews', 'reviews_hidden_is_moderated', $def$
  CHECK (
    status <> 'hidden' OR (moderated_by_user_id IS NOT NULL AND moderated_at IS NOT NULL)
  )
$def$);

SELECT add_constraint_if_missing('reviews', 'reviews_report_evidence', $def$
  CHECK (
    (report_status = 'none')
    = (reported_at IS NULL AND report_reason IS NULL)
  )
$def$);

SELECT add_constraint_if_missing('reviews', 'reviews_reply_evidence', $def$
  CHECK (
    (partner_reply IS NULL) = (partner_replied_at IS NULL)
  )
$def$);

SELECT add_constraint_if_missing('reviews', 'reviews_reply_present', $def$
  CHECK (
    partner_reply IS NULL OR length(btrim(partner_reply)) >= 3
  )
$def$);

-- ── P-006, as a rule the database keeps ─────────────────────────────────────
--
-- Two things, and they are different:
--
--   1. A review is never DELETED. Not by a partner, not by staff, not by a
--      service with a bug. Hiding one is a moderation decision that leaves the
--      row and names who made it.
--
--   2. What the guest WROTE never changes. `rating` and `body` are frozen at
--      insert. A review whose text can be edited is not a review, it is a claim
--      about what somebody said — and the partner's reply quoting a sentence
--      that no longer exists is how that becomes visible far too late.
--
-- Everything else stays writable, because the whole point of P-006 is that
-- there IS a remedy: reply to it, or report it.
--
-- RAISE rather than silently ignoring the write, for the same reason
-- `deny_mutation` does: a bug that tries to erase a review should fail loudly in
-- CI, not succeed quietly in production.
CREATE OR REPLACE FUNCTION deny_review_deletion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Review % cannot be deleted (P-006). Reply to it, or report it and let staff hide it.',
    OLD.reference
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reviews_no_delete ON reviews;
CREATE TRIGGER reviews_no_delete
  BEFORE DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION deny_review_deletion();

CREATE OR REPLACE FUNCTION deny_review_content_change() RETURNS trigger AS $$
BEGIN
  IF NEW.rating IS DISTINCT FROM OLD.rating
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.customer_profile_id IS DISTINCT FROM OLD.customer_profile_id
  THEN
    RAISE EXCEPTION
      'Review % is a record of what a guest wrote; its score and text cannot be changed.',
      OLD.reference
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reviews_content_immutable ON reviews;
CREATE TRIGGER reviews_content_immutable
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION deny_review_content_change();

-- ── The aggregate cannot drift ──────────────────────────────────────────────
--
-- `properties.rating` and `properties.reviews_count` were documented as
-- "worker-maintained" while no worker existed and no review did either. They
-- are recomputed here, in the same transaction as the write that changed them,
-- because a rating maintained by application code drifts the first time a code
-- path forgets — and this particular number decides search position.
--
-- Counted over PUBLISHED reviews only. A hidden review is one staff decided
-- should not be shown; leaving it in the average would keep it working on the
-- listing's ranking after it had been taken off the page.
CREATE OR REPLACE FUNCTION recompute_property_rating() RETURNS trigger AS $$
DECLARE
  target uuid := COALESCE(NEW.property_id, OLD.property_id);
BEGIN
  UPDATE properties p
  SET rating = agg.avg_rating,
      reviews_count = agg.n
  FROM (
    SELECT round(avg(rating)::numeric, 1) AS avg_rating,
           count(*)::int AS n
    FROM reviews
    WHERE property_id = target AND status = 'published'
  ) agg
  WHERE p.id = target;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reviews_maintain_rating ON reviews;
CREATE TRIGGER reviews_maintain_rating
  AFTER INSERT OR UPDATE OF status, property_id ON reviews
  FOR EACH ROW EXECUTE FUNCTION recompute_property_rating();
