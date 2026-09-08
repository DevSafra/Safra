/*
  Letting the partner take part in the dispute that freezes their money.

  Bashar's decision, 2026-09-08: "I want SAFRA to function as an adjudicator that hears both sides
  while still protecting customer privacy… I do not want SAFRA deciding disputes while only one side
  is able to participate in the process."

  ## What was wrong

  A guest complained, the partner's payable froze, SAFRA decided, and the partner was told only when
  it was over — by a "your payout is released" notice. There was no notification when a dispute
  opened, no view of it in the portal beyond a held amount on مستحقاتي, and nowhere for the partner
  to put their account of the night. `dispute_evidence` was written by the customer or by staff; the
  partner could file nothing. The API's own comment stated the open question honestly: "whether they
  should also read and answer the complaint is a product decision nobody has taken."

  ## Why a table rather than the dispute's conversation

  `conversations_exactly_one_subject_v2` is a CHECK: a row carrying `dispute_id` cannot also carry
  `partner_id`, so a dispute thread structurally cannot include the host — and that is the right
  shape, because the customer's live messages are not something the host reads. The partner's side
  belongs in the CASE FILE the operator reads when deciding, which is what this table is.

  Append-only, like `dispute_evidence` and `messages`: a response is what somebody said at a moment,
  and a record of a disagreement that can be edited afterwards is not a record. `deny_mutation` is
  attached in migrations/post beside the other two.

  ## Bodies are stored REDACTED

  Same rule as every other body on the platform: `redactContactDetails` runs before the insert, so a
  partner pasting a guest's phone number into their account of the night does not create a copy of
  it. `redacted_count` is not stored — the disputes query derives it from the text, because a
  counter can drift from what the reader actually sees.
*/

CREATE TABLE IF NOT EXISTS dispute_responses (
  id uuid PRIMARY KEY DEFAULT uuidv7(),

  dispute_id uuid NOT NULL REFERENCES disputes (id),

  /* Already redacted by the caller. Never the original. */
  body text NOT NULL,

  /*
    Who wrote it. NOT NULL, unlike `dispute_evidence.uploaded_by_user_id`.

    A response only ever comes from a signed-in partner user — an owner or an employee holding the
    permission — so there is no "the customer filed it" case to represent with a null. Making it
    required means "who said this" is always answerable, which is the whole value of the record.
  */
  submitted_by_user_id uuid NOT NULL REFERENCES users (id),

  created_at timestamptz NOT NULL DEFAULT now()
);

/* The case file, oldest first: a response is read in the order it was given. */
CREATE INDEX IF NOT EXISTS dispute_responses_dispute_idx
  ON dispute_responses (dispute_id, created_at);

/*
  A customer file the partner may see, by an explicit staff decision.

  Bashar: "Do not expose customer-private files, photos or other evidence directly to the partner…
  If staff determine that a customer image or file is necessary for a fair resolution, then that
  should be an explicit staff decision and not the default behaviour."

  So the DEFAULT is false and stays false unless somebody chooses otherwise, and the choosing is
  audited as `dispute.evidence_shared`. A partner's OWN upload needs no flag — they filed it — which
  is why this is about visibility rather than about ownership.
*/
ALTER TABLE dispute_evidence
  ADD COLUMN IF NOT EXISTS shared_with_partner boolean NOT NULL DEFAULT false;

/*
  Who shared it and when, on the row itself as well as in the audit log.

  The audit log is the answer to "who did this"; this is the answer to "is this file shared, and
  since when" without a join to a log a partner-facing query has no business reading.
*/
ALTER TABLE dispute_evidence
  ADD COLUMN IF NOT EXISTS shared_at timestamptz;

ALTER TABLE dispute_evidence
  ADD COLUMN IF NOT EXISTS shared_by_user_id uuid REFERENCES users (id);

/*
  Shared implies a timestamp, and a timestamp implies shared.

  A row saying "visible to the partner" with no record of when it became visible is not something
  this table should be able to hold — it is the same reasoning as the CHECK that makes a closed
  dispute carry a resolution.
*/
ALTER TABLE dispute_evidence
  DROP CONSTRAINT IF EXISTS dispute_evidence_shared_consistent;

ALTER TABLE dispute_evidence
  ADD CONSTRAINT dispute_evidence_shared_consistent
  CHECK ((shared_with_partner = false AND shared_at IS NULL)
      OR (shared_with_partner = true AND shared_at IS NOT NULL));
