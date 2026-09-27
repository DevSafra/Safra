import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `db:testbed` deletes, so it must refuse a database that is not a developer's.
 *
 * ## The change that made this necessary
 *
 * Every delete in the seed used to be scoped to the fixture partners by email, so a misdirected
 * `DATABASE_URL` would have damaged only rows it could identify as its own. On 2026-09-27 that
 * stopped being true: clearing SAFRA's own treasury — so `e2e/safra-treasury.spec.ts` can claim a
 * period instead of skipping — is necessarily UNSCOPED, because SAFRA's treasury belongs to no
 * partner. Those are financial records with balanced ledger groups behind them, and `ledger_entries`
 * is append-only precisely so nothing can quietly remove one.
 *
 * The seed's own note had already assumed a guard that did not exist: «`db:reset-dev` refuses a
 * non-local connection string, and this script only ever runs beside it». They are separate
 * scripts, and `pnpm db:testbed` reads `DATABASE_URL` on its own.
 *
 * ## Why this reads the source
 *
 * Importing the script runs it. The guard is the first thing `main` does and there is nothing to
 * call in isolation, so the assertion is that the call and the refusal are both present and that
 * the allow-list is a list rather than a pattern — a regex over the host is how `localhost.evil.com`
 * gets in.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'apps/api/src/scripts/seed-testbed.ts'),
  'utf8',
);

describe('the testbed seed', () => {
  it('checks the database before it does anything', () => {
    /* Called from `main`, before `createDatabase` — a guard after the connection is not a guard. */
    const guard = SOURCE.indexOf('refuseANonLocalDatabase(databaseUrl);');
    const connect = SOURCE.indexOf('createDatabase(databaseUrl');

    expect(guard, 'the guard is called').toBeGreaterThan(-1);
    expect(guard, 'and called BEFORE the connection is opened').toBeLessThan(connect);
  });

  it('refuses rather than warns', () => {
    expect(SOURCE).toContain('Refusing to seed a non-local database');
  });

  /**
   * An ALLOW-LIST of exact hosts, never a substring or a regex.
   *
   * `url.includes('localhost')` is true of `https://localhost.attacker.example`, and
   * `/localhost/.test(host)` is true of `prod-localhost-replica`. The hostname is compared for
   * equality against a written list, which is the only form of this check that cannot be widened by
   * a name somebody else chooses.
   */
  it('compares the hostname for equality against a written list', () => {
    expect(SOURCE).toContain('new URL(url).hostname');
    expect(SOURCE).toMatch(/\[[^\]]*'localhost'[^\]]*\]\.includes\(host\)/s);
  });

  /** A URL it cannot parse is refused too: «I could not tell» is not a reason to delete anything. */
  it('refuses a connection string it cannot parse', () => {
    expect(SOURCE).toContain('DATABASE_URL is not a URL this script can check');
  });
});
