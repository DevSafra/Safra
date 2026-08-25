import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { redactContactDetails } from '../messaging/redaction.js';
import { describeError } from '../common/errors/safe-error.js';

/** What a worker knows about a job that has run out of attempts. */
export interface DeadLetter {
  readonly queue: string;
  readonly name: string;
  readonly jobId: string;
  readonly payload: unknown;
  /**
   * The caught error ITSELF, not a message taken off it.
   *
   * `unknown` on purpose (`O-sec-7`, 2026-08-25). Every one of the five processors used to pass
   * `error.message`, which for a `DrizzleQueryError` is `Failed query: <sql>\nparams: <the bound
   * VALUES>` — so `dead_letter_jobs.error` held bound parameters AT REST, on a row a support screen
   * shows. `redactContactDetails` below caught an address in an SMTP rejection and could never catch
   * an Argon2id hash or an encrypted TOTP secret.
   *
   * Taking the error rather than a string moves the guarantee to the BOUNDARY: five callers cannot
   * each get it right, and the sixth one added later would not know there was anything to get right.
   * Same reasoning as the payload mask on the line below — "the mask belongs in the row, not in the
   * renderer".
   */
  readonly error: unknown;
  readonly attempts: number;
}

/**
 * Moves an exhausted job somewhere that outlives Redis.
 *
 * ## Why this is not "BullMQ already tracks failures"
 *
 * It does, in a Redis set nothing reads. `docs/background-jobs-design.md`: a job that exhausts its
 * attempts stays in `failed`, **and that is insufficient, because nothing reads `failed`**. No
 * screen, no alert, no query — and it is in Redis, so a failover or a flush takes the only record
 * that the work was ever attempted. This writes a row instead: durable, queryable, and alertable on
 * the table rather than on the queue.
 *
 * ## Recording must never be the thing that fails
 *
 * This runs inside a worker's `failed` handler, where there is no caller and no request. If the
 * insert throws, the job is lost silently and the alert never fires — the exact outcome the table
 * exists to prevent. So every error here is swallowed after being logged, in the same shape and for
 * the same reason as `NotificationService.notify`.
 */
@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(letter: DeadLetter): Promise<void> {
    try {
      /*
        The payload is REDACTED, not stored verbatim.

        A mail job's payload is an address and a rendered body; this table is read by support staff
        from a console screen. That is the same population and the same argument as `notifications`
        refusing to store a recipient — the mask belongs in the row, not in the renderer, because a
        renderer can be bypassed by anyone with a psql prompt.
      */
      const payload = redactedJson(letter.payload);

      /*
        BOTH masks, in this order, because they catch different things.

        `describeError` removes the bound parameters and keeps the SQL, the error name and the
        SQLSTATE — the standard shape everything else in the API logs. `redactContactDetails` then
        handles what that cannot: an SMTP rejection quoting a recipient's address, which is a plain
        message and not a query at all. Neither is sufficient alone, and the 2,000-character bound
        stays so one enormous statement cannot fill the column.
      */
      const error = redactContactDetails(describeError(letter.error)).body.slice(
        0,
        2_000,
      );

      await this.db.execute(sql`
        INSERT INTO dead_letter_jobs (queue, name, job_id, payload, error, attempts)
        VALUES (${letter.queue}, ${letter.name}, ${letter.jobId},
                ${payload}::jsonb, ${error}, ${String(letter.attempts)})
      `);

      /*
        Logged at ERROR as well as recorded. The row is what alerting watches; the log line is what
        somebody reads at 3am, and it carries no payload — only where to look.
      */
      this.logger.error(
        `Dead letter: ${letter.queue}/${letter.name} job ${letter.jobId} failed after ` +
          `${letter.attempts} attempts. See /jobs.`,
      );
    } catch (cause) {
      this.logger.error(
        `Could not record a dead letter for ${letter.queue}/${letter.name} job ` +
          `${letter.jobId}: ${describeError(cause)}`,
      );
    }
  }
}

/**
 * The payload, redacted, and guaranteed to still be JSON.
 *
 * Redaction runs over the SERIALISED form, because a payload is an arbitrary object and walking it
 * would mean deciding which fields might hold an address — a list that is wrong the moment somebody
 * adds a job type. Masking the text catches every one of them.
 *
 * The mask is bracket-and-Arabic and contains no quote or backslash, so the result parses. That is a
 * property of the current mask rather than a guarantee, and this runs inside a failure handler where
 * a thrown error loses the evidence the row exists to preserve — so it is CHECKED, and a payload
 * that will not round-trip is replaced by a note saying so instead of taking the insert down.
 */
function redactedJson(payload: unknown): string {
  let serialised: string;

  try {
    serialised = JSON.stringify(payload ?? null);
  } catch {
    /* Circular, or a BigInt. Neither should reach a queue, and neither may break this. */
    return JSON.stringify({ unserialisable: true });
  }

  const masked = redactContactDetails(serialised).body;

  try {
    JSON.parse(masked);

    return masked;
  } catch {
    return JSON.stringify({ redactionBrokeStructure: true, bytes: serialised.length });
  }
}
