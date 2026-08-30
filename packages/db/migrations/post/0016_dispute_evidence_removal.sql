-- Evidence can be REMOVED, and removal leaves a mark.
--
-- The table was built append-only on the reasoning that «evidence that can be edited or removed
-- after the fact is not evidence», which is right about the RECORD and wrong about the world: a
-- photograph gets filed by mistake, twice, or with somebody else's data in the frame, and a file
-- that can never be corrected is its own integrity problem — and, where the frame holds personal
-- data nobody consented to, a compliance one.
--
-- So: a soft delete, never a DELETE. The row stays, the bytes stay addressable to a re-drive, and
-- `dispute.evidence_removed` in the audit log says who removed it and when. Nothing vanishes; it
-- stops counting and stops being served.
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- The reads all filter on it, and every one of them is per dispute.
CREATE INDEX IF NOT EXISTS dispute_evidence_live_idx
  ON dispute_evidence (dispute_id, created_at)
  WHERE deleted_at IS NULL;
