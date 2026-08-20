import { sql } from 'drizzle-orm';
import { authenticator } from 'otplib';

import { createDatabase } from '@safra/db';

import type { Env } from '../config/env.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { PasswordService } from '../common/crypto/password.service.js';

/**
 * The accounts and the exchange rate that scenarios 2, 3 and 4 of `docs/load-testing.md` cannot run
 * without.
 *
 * ## `ON CONFLICT (email) WHERE deleted_at IS NULL`
 *
 * `users_email_unique` is a PARTIAL unique index — unique among the rows that are not soft-deleted,
 * so the same address can be re-registered after an account is closed. Arbiter inference will not
 * pick a partial index from the column list alone; the index's own predicate has to be repeated in
 * the ON CONFLICT clause or the statement fails with "no unique or exclusion constraint matching the
 * ON CONFLICT specification". Every upsert against `users` needs that clause.
 *
 * ## Why this exists
 *
 * The plan said the harness was finished — "Ready to execute the day a deployment target exists.
 * Nothing here needs further design." Three of the six scenarios could not be started:
 *
 *   - **Scenario 2** quotes and creates bookings. `db:seed` deliberately seeds NO FX rate ("a
 *     hardcoded one goes stale, and a wrong rate is worse than a missing one because it looks
 *     plausible"), and without one every quote answers 503. The scenario would have failed its
 *     `bookings_created > 0` threshold and read as a booking defect.
 *   - **Scenario 3** needs `LOAD_STAFF_TOKEN`, and the load database has no staff at all — the
 *     generator makes customers. Staff also carry mandatory TOTP, so even a bootstrapped admin
 *     cannot reach a registry until a second factor is enrolled.
 *   - **Scenario 4** needs a bystander with a real password and a population of accounts to attack.
 *     Pointed at accounts that do not exist it still measures the limiter, but it cannot show the
 *     five-attempt LOCKOUT firing, which is half of what the plan asks it to prove.
 *
 * So the gap was not tooling, it was three prerequisites nobody had written down. This is them, in
 * one re-runnable command, so the next run starts rather than investigates.
 *
 * ## It writes KNOWN credentials, so it is name-guarded like the generator
 *
 * Every account here has a password this file prints. That is correct for a throwaway load database
 * and catastrophic anywhere else, so the same allow-list the generator uses applies: a database
 * whose name does not contain `load` is refused before anything is written. The guard is on the NAME
 * because the mistake it prevents is one character in a URL.
 *
 * ## Idempotent
 *
 * Scenario 4 drives accounts into lockout by design, so this has to be re-runnable between runs to
 * clear them. Every write is an upsert and the lockout counters are reset, which is why it is safe
 * to run before each scenario rather than once per database.
 *
 * Usage:
 *   LOAD_DATABASE_URL=… FIELD_ENCRYPTION_KEY=… pnpm load:accounts
 */

/**
 * The fixed credentials, and the rule that keeps them safe.
 *
 * These are written into the repository on purpose: a harness whose passwords have to be discovered
 * is a harness that does not run. They are safe only while the database is a local throwaway, so
 * `requireOverridesOffLocalhost` REFUSES to use a published default against a non-local host —
 * the capacity run against provisioned infrastructure has to supply its own.
 *
 * Without that guard, the day someone runs this against a real load environment there is a
 * `super_admin` on it whose password is in a public git history.
 */
const STAFF_EMAIL = process.env['LOAD_STAFF_EMAIL'] ?? 'load-staff@safra.test';
const STAFF_PASSWORD = process.env['LOAD_STAFF_PASSWORD'] ?? 'Load-Test-Staff-Passw0rd!';

/** The bystander of scenario 4 — a legitimate customer sharing the attackers' address. */
const BYSTANDER_EMAIL =
  process.env['LOAD_BYSTANDER_EMAIL'] ?? 'load-bystander@safra.test';
const BYSTANDER_PASSWORD =
  process.env['LOAD_BYSTANDER_PASSWORD'] ?? 'Load-Test-Bystander-Passw0rd!';

/**
 * The accounts scenario 4 attacks, named as the scenario names them.
 *
 * `load/04-auth-under-attack.js` builds `victim-${n}@safra.test` for n < 5,000. They must be REAL
 * for the lockout path to run: a wrong password against an address that does not exist is refused
 * by the generic 401 and never reaches the five-attempt counter.
 */
const VICTIM_COUNT = 5_000;
const VICTIM_PASSWORD =
  process.env['LOAD_VICTIM_PASSWORD'] ?? 'Load-Test-Victim-Passw0rd!';

/**
 * The TOTP secret the load staff account carries.
 *
 * Fixed rather than generated so `pnpm load:token` can mint a code without a round trip to fetch it,
 * exactly as `TESTBED_PARTNER_TOTP_SECRET` works for the browser fixtures.
 */
const STAFF_TOTP_SECRET =
  process.env['LOAD_STAFF_TOTP_SECRET'] ?? 'KRSXG5CTMVRXEZLUMU2TAMBQGAYA';

/** The rate `db:seed` refuses to invent. Any plausible figure serves — nothing here prices for real. */
const USD_TO_SYP = '13000.00000000';

function assertLoadDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');

  if (!/(^|_)load(_|$)/.test(name)) {
    throw new Error(
      `Refusing to write known credentials into "${name}". This script creates accounts whose ` +
        'passwords it prints, and only ever targets a database whose name contains "load".',
    );
  }
}

/**
 * A published default password may only ever reach a LOCAL database.
 *
 * The name guard above stops this touching the development or production database. It does not stop
 * it creating a `super_admin` with a repository-published password on a load environment that is
 * reachable from somewhere else — which is exactly the environment the capacity run needs, so it will
 * happen unless something refuses.
 *
 * Off localhost, every credential must be supplied. The message names the variables rather than
 * saying "set the environment", because a guard people work around by guessing is not a guard.
 */
function requireOverridesOffLocalhost(url: string): void {
  const { hostname } = new URL(url);

  if (['localhost', '127.0.0.1', '::1', '0.0.0.0', ''].includes(hostname)) return;

  const missing = (
    [
      ['LOAD_STAFF_PASSWORD', 'LOAD_STAFF_PASSWORD'],
      ['LOAD_BYSTANDER_PASSWORD', 'LOAD_BYSTANDER_PASSWORD'],
      ['LOAD_VICTIM_PASSWORD', 'LOAD_VICTIM_PASSWORD'],
      ['LOAD_STAFF_TOTP_SECRET', 'LOAD_STAFF_TOTP_SECRET'],
    ] as const
  )
    .filter(([variable]) => !process.env[variable])
    .map(([, name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `"${hostname}" is not local, so the published default credentials in this file must not be ` +
        `used. Set: ${missing.join(', ')}.\n\n` +
        'They are printed in the repository so a LOCAL harness runs without discovery. Against ' +
        'anything reachable from elsewhere they would leave a super_admin whose password is in a ' +
        'public git history.',
    );
  }
}

async function main(): Promise<void> {
  const url = process.env['LOAD_DATABASE_URL'] ?? process.env['DATABASE_URL'];

  if (!url) throw new Error('LOAD_DATABASE_URL is required.');

  assertLoadDatabase(url);
  requireOverridesOffLocalhost(url);

  const key = process.env['FIELD_ENCRYPTION_KEY'];

  if (!key) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY is required: the staff account enrols a second factor, and the secret ' +
        'is stored encrypted exactly as a real enrolment stores it.',
    );
  }

  const encryption = new FieldEncryptionService({ FIELD_ENCRYPTION_KEY: key } as Env);
  const passwords = new PasswordService();
  const db = createDatabase(url, 4);

  try {
    const currency = await db.execute<{ usd: string; syp: string }>(sql`
      SELECT (SELECT id::text FROM currencies WHERE code = 'USD') AS usd,
             (SELECT id::text FROM currencies WHERE code = 'SYP') AS syp
    `);

    const { usd, syp } = currency.rows[0] ?? {};

    if (!usd || !syp) {
      throw new Error('Reference data is missing. Run db:migrate and db:seed first.');
    }

    /*
      One rate, inserted only when the pair has none.

      `fx_rates` is history rather than state — the lookup index is
      (base, quote, effective_from) and pricing reads the latest row at or before now. So a second
      run must not stack another row: the rate would be identical and the table would grow a
      duplicate for every invocation, which is the sort of thing that later reads as a data bug.
    */
    const rate = await db.execute<{ id: string }>(sql`
      INSERT INTO fx_rates (base_currency_id, quote_currency_id, rate, effective_from, source)
      SELECT ${usd}::uuid, ${syp}::uuid, ${USD_TO_SYP}::numeric, now() - interval '1 day',
             'load-test'
      WHERE NOT EXISTS (
        SELECT 1 FROM fx_rates
        WHERE base_currency_id = ${usd}::uuid AND quote_currency_id = ${syp}::uuid
      )
      RETURNING id
    `);

    console.log(
      rate.rows.length > 0
        ? `  fx rate        USD→SYP ${USD_TO_SYP} inserted`
        : '  fx rate        already configured, left alone',
    );

    const staffHash = await passwords.hash(STAFF_PASSWORD);
    const bystanderHash = await passwords.hash(BYSTANDER_PASSWORD);
    const victimHash = await passwords.hash(VICTIM_PASSWORD);

    /*
      The staff account, with TOTP already enrolled.

      `TwoFactorGuard` refuses every staff request until a second factor exists, so a bootstrapped
      admin without one can reach the enrolment endpoints and nothing else — and scenario 3 reads
      registries. Enrolling here rather than over HTTP keeps the prerequisite in one place.

      `super_admin` because scenario 3 walks a registry and the point of the run is the OFFSET cost,
      not the permission matrix. A narrower role would make a 403 look like a pagination result.
    */
    await db.execute(sql`
      INSERT INTO users (email, password_hash, role, status, preferred_locale, email_verified_at,
                         totp_secret_encrypted, totp_enabled_at, totp_recovery_code_hashes)
      VALUES (${STAFF_EMAIL}, ${staffHash}, 'super_admin', 'active', 'ar', now(),
              ${encryption.encrypt(STAFF_TOTP_SECRET)}, now(), '{}')
      ON CONFLICT (email) WHERE deleted_at IS NULL DO UPDATE
        SET password_hash            = EXCLUDED.password_hash,
            role                     = 'super_admin',
            status                   = 'active',
            totp_secret_encrypted    = EXCLUDED.totp_secret_encrypted,
            totp_enabled_at          = now(),
            failed_login_attempts    = 0,
            locked_until             = NULL,
            deleted_at               = NULL
    `);

    console.log(`  staff          ${STAFF_EMAIL} (super_admin, TOTP enrolled)`);

    await db.execute(sql`
      INSERT INTO users (email, password_hash, role, status, preferred_locale, email_verified_at)
      VALUES (${BYSTANDER_EMAIL}, ${bystanderHash}, 'customer', 'active', 'ar', now())
      ON CONFLICT (email) WHERE deleted_at IS NULL DO UPDATE
        SET password_hash         = EXCLUDED.password_hash,
            status                = 'active',
            failed_login_attempts = 0,
            locked_until          = NULL,
            deleted_at            = NULL
    `);

    /*
      A customer needs a profile before anything customer-facing works, and the bystander signs in
      for real. Separate statement rather than a CTE so the re-run path is readable.
    */
    await db.execute(sql`
      INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest, preferred_locale)
      SELECT u.id, 'Load Bystander', u.email, '+963900000199', false, 'ar'
      FROM users u
      WHERE u.email = ${BYSTANDER_EMAIL}
        AND NOT EXISTS (SELECT 1 FROM customer_profiles c WHERE c.user_id = u.id)
    `);

    console.log(`  bystander      ${BYSTANDER_EMAIL} (customer)`);

    /*
      The attacked population, in ONE statement with ONE hash.

      Argon2id is deliberately slow — that is the entire point of it — so hashing five thousand
      passwords one at a time would take minutes and prove nothing. Every victim shares a hash
      because no test ever verifies one: the scenario only ever sends wrong passwords, and what it
      needs from these rows is that the address EXISTS so the attempt counter advances.

      The password is printed anyway. An account with a hash nobody can name is a loose end.
    */
    await db.execute(sql`
      INSERT INTO users (email, password_hash, role, status, preferred_locale, email_verified_at)
      SELECT 'victim-' || n || '@safra.test', ${victimHash}, 'customer', 'active', 'ar', now()
      FROM generate_series(0, ${VICTIM_COUNT - 1}) AS n
      ON CONFLICT (email) WHERE deleted_at IS NULL DO UPDATE
        SET failed_login_attempts = 0,
            locked_until          = NULL,
            status                = 'active'
    `);

    console.log(
      `  victims        victim-0…victim-${VICTIM_COUNT - 1}@safra.test ` +
        '(lockout counters reset)',
    );

    /*
      Printed only when they are the published defaults against a local database — which is the case
      where printing them costs nothing and saves a lookup. When they came from the environment the
      caller already has them, and echoing a supplied password into a terminal scrollback or a CI log
      is how a real one leaks.
    */
    const supplied = Boolean(process.env['LOAD_STAFF_PASSWORD']);

    console.log(
      '\nExport these for the scenarios that need them:\n\n' +
        `  export LOAD_BYSTANDER_EMAIL='${BYSTANDER_EMAIL}'\n` +
        `  export LOAD_BYSTANDER_PASSWORD='${supplied ? '…as you supplied it…' : BYSTANDER_PASSWORD}'\n` +
        `  export LOAD_STAFF_TOKEN="$(pnpm -s load:token)"\n\n` +
        `Staff sign-in: ${STAFF_EMAIL} / ${supplied ? '…as you supplied it…' : STAFF_PASSWORD}\n` +
        `Current TOTP code: ${authenticator.generate(STAFF_TOTP_SECRET)}\n`,
    );
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
