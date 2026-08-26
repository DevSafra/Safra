import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from './audit.service.js';
import { runWithRequestContext } from '../logging/request-context.js';

/**
 * §15 — «تسجيل IP والجهاز والوقت والموظف في العمليات الحساسة».
 *
 * ## What this replaces
 *
 * The `@Audited` interceptor read the request, so authentication rows carried an origin and
 * everything a service recorded itself did not. Measured on 2026-08-26: every one of 10,338
 * `auth.login_failed` rows had an IP; all 253 `staff.invited` rows had none, and neither did
 * partner approvals, refunds, wallet adjustments or enforcement actions.
 *
 * Threading a parameter through the forty-one files that write audit rows was the obvious fix and
 * the wrong one — it had reached two of them, each edit by hand, each one a place to miss. The
 * origin now rides the request context that already carries the correlation ID, for the reason
 * that context gives for itself: a row written four calls deep in a service that has no idea it is
 * in a request is exactly the row that needs it.
 *
 * ## What is asserted
 *
 * The MECHANISM, at the only place all forty-one services share. A test per service would be a
 * test per call site, which is the same manual enumeration this design exists to avoid.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the origin on an audit row', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const audit = new AuditService(db);

  const FROM = {
    requestId: 'req-origin-test',
    ipAddress: '198.51.100.7',
    userAgent: 'SafraTest/2.0',
  };

  let action = '';

  beforeEach(async () => {
    await harness.begin();
    /* Distinct per test, so a row is found by what this case wrote and nothing else. */
    action = `test.origin_${Math.floor(Date.now() % 1e9)}_${Math.floor(performance.now())}`;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  async function written(): Promise<{ ip: string | null; agent: string | null }> {
    const rows = await db.execute<{ ip: string | null; agent: string | null }>(sql`
      SELECT ip_address AS ip, user_agent AS agent FROM audit_log
      WHERE action = ${action} ORDER BY created_at DESC LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw new Error('No audit row was written.');

    return row;
  }

  /**
   * A service that passes nothing still records where the request came from.
   *
   * This is the whole point: `entry` carries no `ipAddress`, exactly as every administrative
   * service writes it today, and the row has one anyway.
   */
  it('takes it from the request when the caller passes none', async () => {
    await runWithRequestContext(FROM, async () => {
      await audit.record({ action, subjectType: 'test' });
    });

    expect(await written()).toStrictEqual({
      ip: FROM.ipAddress,
      agent: FROM.userAgent,
    });
  });

  /**
   * An explicit value still wins.
   *
   * The staff routes pass one deliberately, and a path replaying work on somebody's behalf must be
   * able to say so rather than inherit whatever request happens to be open.
   */
  it('prefers what the caller named over the ambient request', async () => {
    await runWithRequestContext(FROM, async () => {
      await audit.record({
        action,
        subjectType: 'test',
        ipAddress: '203.0.113.1',
        userAgent: 'Explicit/1.0',
      });
    });

    expect(await written()).toStrictEqual({
      ip: '203.0.113.1',
      agent: 'Explicit/1.0',
    });
  });

  /**
   * Outside a request, both are null — and the row is still written.
   *
   * A scheduled sweep has no device and no address, and inventing one would be worse than the
   * absence: an audit trail that names an origin for work nobody did is a record that misleads.
   * What must never happen is the row going missing because there was no context to read.
   */
  it('records nothing rather than guessing, outside a request', async () => {
    await audit.record({ action, subjectType: 'test' });

    expect(await written()).toStrictEqual({ ip: null, agent: null });
  });

  /**
   * And it survives the awaits.
   *
   * `AsyncLocalStorage` is the mechanism, so the assertion that matters is not "a synchronous call
   * sees it" but that a row written after several hops still does — which is where a naive
   * implementation using a module-level variable would quietly break under concurrency.
   */
  it('reaches a row written several awaits deep', async () => {
    await runWithRequestContext(FROM, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 5));
      await (async () => {
        await audit.record({ action, subjectType: 'test' });
      })();
    });

    expect(await written()).toStrictEqual({
      ip: FROM.ipAddress,
      agent: FROM.userAgent,
    });
  });

  /**
   * Two requests in flight together do not swap origins.
   *
   * The failure a shared variable produces, and the reason this uses async context: under load,
   * one administrator's action recorded against another's address is worse than no address, and it
   * would never reproduce in a single-threaded test that ran them in sequence.
   */
  it('keeps two concurrent requests apart', async () => {
    const first = `${action}_a`;
    const second = `${action}_b`;

    await Promise.all([
      runWithRequestContext({ requestId: 'a', ipAddress: '198.51.100.1' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await audit.record({ action: first, subjectType: 'test' });
      }),
      runWithRequestContext({ requestId: 'b', ipAddress: '198.51.100.2' }, async () => {
        await audit.record({ action: second, subjectType: 'test' });
      }),
    ]);

    const rows = await db.execute<{ action: string; ip: string }>(sql`
      SELECT action, ip_address AS ip FROM audit_log
      WHERE action IN (${first}, ${second})
    `);

    const byAction = new Map(rows.rows.map((row) => [row.action, row.ip]));

    expect(byAction.get(first)).toBe('198.51.100.1');
    expect(byAction.get(second)).toBe('198.51.100.2');
  });
});
