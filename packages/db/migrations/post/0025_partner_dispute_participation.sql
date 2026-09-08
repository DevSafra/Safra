-- ----------------------------------------------------------------------------
-- The partner's account of a dispute is append-only, like every other record
-- of what somebody said.
--
-- `messages`, `dispute_evidence`, `audit_log` and `ledger_entries` all carry
-- this trigger for one reason: a record of a disagreement that can be edited
-- after the fact is not a record. A partner who wants to add something writes
-- another response; the operator reads both, in order, which is what the
-- ordering index exists for.
--
-- It RAISES rather than silently discarding the write, so a bug that tries to
-- rewrite a response fails loudly in CI instead of succeeding quietly.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS dispute_responses_immutable ON dispute_responses;

CREATE TRIGGER dispute_responses_immutable
  BEFORE UPDATE OR DELETE ON dispute_responses
  FOR EACH ROW EXECUTE FUNCTION deny_mutation();

-- And the hole a row-level trigger cannot cover: PostgreSQL fires no row
-- trigger on TRUNCATE, so the whole case file could be emptied with no error
-- and no trace. Same guard the other append-only tables carry.
DROP TRIGGER IF EXISTS dispute_responses_no_truncate ON dispute_responses;

CREATE TRIGGER dispute_responses_no_truncate
  BEFORE TRUNCATE ON dispute_responses
  FOR EACH STATEMENT EXECUTE FUNCTION deny_mutation();
