/*
  Splitting `failed` into «another attempt is owed» and «nobody will try again».

  Bashar's decision, 2026-09-09: "A temporarily failed notification should remain retryable. Failed
  notifications older than the permitted backoff window should be picked up automatically for
  redelivery. After the maximum number of failed attempts, the notification should move to an
  explicit terminal state such as abandoned or to the dead-letter process… Please use the clearest
  state model rather than allowing failed to mean both 'waiting for retry' and 'permanently
  abandoned'."

  ## What was wrong

  `failed` meant both, and the consequence was measured rather than imagined: **1,041 rows sat in
  it**, spanning 2026-08-08 to 2026-09-08, 936 of them older than a day, and **1,036 were
  `booking.needs_action`** — the notice that tells a partner a booking is waiting on them. All had
  `attempts = 1`; `dead_letter_jobs` held zero mail rows and Redis held none, so they had been
  attempted once and their retry never fired.

  Three mechanisms exist to catch a lost notice and every one keyed on a state these were not in:
  the `notifications all terminal` invariant selects `queued`, `NotificationRedriveService` selected
  `queued`, and the dead-letter screen is only reached when a job EXHAUSTS its attempts — which a
  job that vanished never does. So "was the partner told?" was unanswerable, and nothing said so.

  ## What this migration does, and deliberately does not

  It adds the value and an index for the recovery scan. It does NOT move the 1,041 existing rows:
  they are `failed` with attempts remaining, which is exactly the state the new sweep is written to
  recover, so leaving them is what gets them delivered. Moving them to `abandoned` would be the
  opposite — declaring, in a migration, that a thousand partners will never be told.
*/
ALTER TYPE "public"."notification_status" ADD VALUE IF NOT EXISTS 'abandoned';
--> statement-breakpoint
/*
  The recovery scan's index: the two states it looks at, in the order it reads them.

  PARTIAL, because `sent` and `delivered` are the overwhelming majority of this table and none of
  them is ever a candidate — indexing them would be paying for rows the query excludes by
  definition. `queued_at` is the ORDER BY, so the scan can stop at the batch limit rather than sort.
*/
CREATE INDEX IF NOT EXISTS "notifications_recovery_idx"
  ON "notifications" USING btree ("queued_at")
  WHERE status IN ('queued', 'failed');
