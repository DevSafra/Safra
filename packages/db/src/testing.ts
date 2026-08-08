import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, type QueryArrayConfig, type QueryConfig } from 'pg';

import * as schema from './schema/index.js';
import type { Database } from './client.js';

/**
 * A database handle for integration tests that leaves NOTHING behind.
 *
 * ## The problem
 *
 * `pnpm vitest run` against a real PostgreSQL created rows and never removed them. One full run
 * added roughly a hundred users and forty partners; by 2026-08-06 a development database held
 * 12,297 users, 2,262 of them super admins, and 1,468 orphan properties — none authored by a
 * person. A staff console with five thousand fake partners in الشركاء cannot be judged by eye,
 * which is the only thing a staff console is for.
 *
 * Worse, some of it could not be cleaned up at all. `deny_paid_payout_mutation` refuses to delete a
 * paid payout — correctly, because it records money that left the company — so an `afterAll` was
 * never going to work for the payout suite, and those rows then blocked `db:testbed` outright.
 *
 * ## Why the wrapper is on the CLIENT, not on drizzle
 *
 * Every path drizzle offers — `execute`, the query builders, `db.query.*`, and its own
 * `transaction()` — bottoms out in one `client.query` call. Wrapping there covers all of them at
 * once, and, decisively, it covers the SERVICES: they hold a `Database` and call
 * `this.db.transaction(...)` internally, and no amount of test-side discipline reaches inside them.
 *
 * ## How it works
 *
 * One dedicated connection, one real `BEGIN` at the start of each test, one real `ROLLBACK` at the
 * end. In between:
 *
 * - **A nested `BEGIN` becomes `SAVEPOINT`**, `COMMIT` becomes `RELEASE`, `ROLLBACK` becomes
 *   `ROLLBACK TO`. So a service's own transaction still behaves like a transaction — it commits or
 *   it does not, and a failure inside it still undoes its own work — while the OUTER transaction
 *   stays open and discardable. Without this a service's `COMMIT` would commit the test's rows for
 *   real, which is the whole thing being prevented.
 * - **Every other statement runs inside its own savepoint.** This is not tidiness: in PostgreSQL a
 *   failed statement poisons the entire transaction, and these tests deliberately provoke failures
 *   — a unique index, an append-only trigger, a check constraint — and then go on asserting. Under
 *   a plain transaction the first `rejects.toThrow()` would leave every later query answering
 *   "current transaction is aborted". Per-statement savepoints make a failure local, which is what
 *   the tests were already written to assume.
 *
 * ## What this does NOT change
 *
 * Every trigger, constraint and index still runs — this is a real database doing real work, and a
 * test that violates an append-only rule still gets refused by the rule rather than by a mock.
 * Only the durability is removed. Audit rows, ledger entries and payouts are written, asserted,
 * and then never existed.
 *
 * ## What it costs
 *
 * Three round trips per statement instead of one, and one connection per suite. Measured across
 * the whole integration suite the difference is seconds, against an afternoon every few weeks
 * spent clearing a database by hand.
 *
 * ## The one thing to know when writing a test
 *
 * Data does not survive the test that made it. A fixture built in `beforeEach` is correct; a
 * fixture built once in `beforeAll` and relied on by later tests is not, because the rollback
 * between them takes it away. That is the opposite of the old behaviour and it fails loudly rather
 * than silently, which is the right way round.
 */

/** Statements the wrapper rewrites, matched on the leading keyword only. */
const TRANSACTION_CONTROL = /^\s*(begin|start transaction|commit|rollback)\b(?!\s+to\b)/i;

/**
 * Drizzle's OWN savepoints, which pass through untouched.
 *
 * A nested `tx.transaction()` issues `savepoint sp1` / `release savepoint sp1` directly. Wrapping
 * those in a statement savepoint of our own destroys them: releasing the outer point discards
 * `sp1`, and drizzle's later `release savepoint sp1` then fails against a point that no longer
 * exists — which aborts the transaction and surfaces as a lost write several assertions later.
 */
const OWN_SAVEPOINT = /^\s*(savepoint|release\s+savepoint|rollback\s+to)\b/i;

export interface RollbackDatabase {
  /** The drizzle handle to hand to services and to query directly. */
  readonly db: Database;
  /** Opens the enclosing transaction. Call in `beforeEach`. */
  begin(): Promise<void>;
  /** Discards everything the test did. Call in `afterEach`. */
  rollback(): Promise<void>;
  /** Closes the connection. Call in `afterAll`. */
  close(): Promise<void>;
}

type QueryArgs = [string | QueryConfig | QueryArrayConfig, ...(readonly unknown[])[]];

export function createRollbackDatabase(connectionString: string): RollbackDatabase {
  const client = new Client({ connectionString, statement_timeout: 15_000 });

  /* Bound before the override, so the wrapper can issue its own statements without recursing. */
  const raw = client.query.bind(client) as (
    ...args: QueryArgs
  ) => Promise<{ rows: unknown[] }>;

  let connected = false;
  let inTransaction = false;
  let counter = 0;

  const textOf = (first: QueryArgs[0]): string =>
    typeof first === 'string' ? first : ((first as QueryConfig).text ?? '');

  /*
    Statements are serialised through a promise chain.

    A savepoint-wrapped statement is THREE round trips, and `pg` interleaves concurrent callers on
    one connection — so two overlapping queries would produce SAVEPOINT-a, SAVEPOINT-b, query-a,
    RELEASE-a, and release the wrong point. Awaiting the previous call before starting the next
    makes each trio atomic.

    The consequence is the documented exception below: a suite whose SUBJECT is two things
    happening at once cannot use this harness, because this removes the at-once.
  */
  let queue: Promise<unknown> = Promise.resolve();

  const serialise = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);

    queue = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  };

  /**
   * The savepoint STACK, not a counter.
   *
   * A counter gets this wrong the first time a service's transaction fails: the names it generates
   * drift from the savepoints that actually exist, and `RELEASE SAVEPOINT nested_2` on a point that
   * was never created is an error — which aborts the transaction and turns every later statement in
   * the test into "current transaction is aborted", reported against whichever assertion happened
   * to come next.
   */
  const stack: string[] = [];

  const wrapped = (...args: QueryArgs): Promise<unknown> => {
    /* Outside a test's transaction, behave exactly like the real client. */
    if (!inTransaction) return raw(...args);

    /*
      EVERYTHING goes through the queue, transaction control included. A savepoint-wrapped statement
      is three round trips, and `pg` interleaves concurrent callers on one connection — so a service
      issuing BEGIN while another statement's trio is mid-flight would nest the wrong way round.
    */
    return serialise(async () => {
      const text = textOf(args[0]);

      /* Drizzle managing its own savepoints — ours must not enclose them. */
      if (OWN_SAVEPOINT.test(text)) return raw(...args);

      const control = TRANSACTION_CONTROL.exec(text);

      if (control) {
        const keyword = (control[1] ?? '').toLowerCase();

        if (keyword === 'begin' || keyword === 'start transaction') {
          counter += 1;
          const name = `nested_${counter}`;

          stack.push(name);

          return raw(`SAVEPOINT ${name}`);
        }

        const name = stack.pop();

        /*
          A COMMIT or ROLLBACK with nothing on the stack is a service closing a transaction this
          wrapper never saw opened. Doing nothing is right: the alternative is releasing a savepoint
          that does not exist, which aborts the whole transaction.
        */
        if (!name) return { rows: [] };

        if (keyword === 'commit') return raw(`RELEASE SAVEPOINT ${name}`);

        /*
          A service rolling ITS transaction back must undo its own work and leave the test's
          transaction usable — `ROLLBACK TO` does that, where a bare `ROLLBACK` would discard the
          enclosing transaction and take the test's fixtures with it.
        */
        return raw(`ROLLBACK TO SAVEPOINT ${name}`);
      }

      /*
        An ordinary statement, in its own savepoint so a refusal stays local. These suites provoke
        constraint violations on purpose and keep asserting afterwards; without this the first one
        would abort the transaction and every later query would fail for an unrelated reason.
      */
      counter += 1;
      const point = `stmt_${counter}`;

      await raw(`SAVEPOINT ${point}`);

      try {
        const result = await raw(...args);

        await raw(`RELEASE SAVEPOINT ${point}`);

        return result;
      } catch (error) {
        await raw(`ROLLBACK TO SAVEPOINT ${point}`);

        throw error;
      }
    });
  };

  (client as unknown as { query: unknown }).query = wrapped;

  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;

  return {
    db,
    async begin() {
      if (!connected) {
        await client.connect();
        connected = true;
      }

      /*
        Through the QUEUE, not straight to the connection.

        `begin` and `rollback` used to call `raw` directly, so the ROLLBACK ending one test could
        overtake a statement still in flight from it — leaving the next test's BEGIN issued against
        a connection whose transaction was already aborted. The symptom was a failure reported
        against whichever assertion ran first in the NEXT test, which is the hardest possible place
        to look for it.
      */
      await serialise(() => raw('BEGIN'));
      inTransaction = true;
      stack.length = 0;
    },
    async rollback() {
      if (!inTransaction) return;

      /* Drains anything still queued from the test before discarding its work. */
      await serialise(() => raw('ROLLBACK'));

      inTransaction = false;
      stack.length = 0;
    },
    async close() {
      if (connected) await client.end();
    },
  };
}
