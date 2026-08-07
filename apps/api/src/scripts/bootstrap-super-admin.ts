import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { createDatabase } from '@safra/db';

import { PasswordService } from '../common/crypto/password.service.js';

/**
 * Creates the first `super_admin` (M-5).
 *
 * ## Why this exists
 *
 * Every staff account after the first is created through the console, which records
 * who granted whom access. The first one cannot be — there is nobody to grant it. The
 * alternative was a human with a psql session on the production database, which is
 * both the access pattern the audit log exists to eliminate and an easy way to create
 * an account with a wrong role or a weak password by hand.
 *
 * ## Refuses to run twice
 *
 * If any usable `super_admin` already exists this exits without changing anything.
 * Otherwise the script would be a permanent back door: anyone who could run it could
 * mint themselves an administrator at any point in the platform's life. Once the
 * platform is administrable, the console is the only way in.
 *
 * ## Credentials come from the environment, never from arguments
 *
 * Command-line arguments appear in shell history and in `ps` output for every user on
 * the machine. `BOOTSTRAP_ADMIN_PASSWORD` is optional: when it is absent a strong
 * password is generated and printed once. That is the better default — it cannot be
 * weak, and it cannot be a password reused from somewhere else.
 *
 *   DATABASE_URL=... BOOTSTRAP_ADMIN_EMAIL=ops@safra.example pnpm bootstrap:admin
 *
 * The account is created WITHOUT two-factor authentication enrolled. That is correct:
 * `TwoFactorGuard` refuses every staff request until TOTP is enabled, so the
 * first sign-in is forced through enrolment before the account can do anything.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  const email = process.env['BOOTSTRAP_ADMIN_EMAIL']?.trim().toLowerCase();

  if (!databaseUrl) fail('DATABASE_URL is required.');
  if (!email) {
    fail(
      'BOOTSTRAP_ADMIN_EMAIL is required.\n\n' +
        '  DATABASE_URL=... BOOTSTRAP_ADMIN_EMAIL=ops@safra.example pnpm bootstrap:admin',
    );
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail(`"${email}" does not look like an email address.`);
  }

  const db = createDatabase(databaseUrl, 2);

  try {
    /**
     * "Usable" means it has a password. An invited-but-unaccepted super admin cannot
     * sign in, so it must not count as proof the platform is administrable — that
     * would leave no way to bootstrap after a mistyped invitation.
     */
    const existing = await db.execute<{ email: string }>(sql`
      SELECT email FROM users
      WHERE role = 'super_admin' AND status = 'active'
        AND password_hash IS NOT NULL AND deleted_at IS NULL
      LIMIT 1
    `);

    if (existing.rows.length > 0) {
      console.log(
        `A super admin already exists (${existing.rows[0]?.email}). ` +
          `Nothing to do — invite further staff from the console.`,
      );
      return;
    }

    const taken = await db.execute(
      sql`SELECT 1 FROM users WHERE email = ${email} AND deleted_at IS NULL`,
    );

    if (taken.rows.length > 0) {
      fail(
        `An account with ${email} already exists but is not a usable super admin. ` +
          `Resolve it deliberately rather than through this script.`,
      );
    }

    const provided = process.env['BOOTSTRAP_ADMIN_PASSWORD'];
    // 32 URL-safe characters. Well past any policy floor and not chosen by a human.
    const password = provided ?? randomBytes(24).toString('base64url');

    if (provided && provided.length < 12) {
      fail('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');
    }

    const hash = await new PasswordService().hash(password);

    const created = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, password_hash, role, status, preferred_locale,
                         email_verified_at)
      VALUES (${email}, ${hash}, 'super_admin', 'active', 'en', now())
      RETURNING id
    `);

    const id = created.rows[0]?.id;

    /**
     * Audited with a null actor and an explicit reason. The row states that this
     * account was created by the bootstrap path rather than granted by a person —
     * which is exactly the distinction an auditor would want to draw.
     */
    await db.execute(sql`
      INSERT INTO audit_log (actor_user_id, action, subject_type, subject_id, after,
                             reason)
      VALUES (NULL, 'staff.bootstrapped', 'user', ${id},
              ${JSON.stringify({ email, role: 'super_admin' })}::jsonb,
              'First super admin created by the bootstrap script; no actor existed.')
    `);

    console.log(`\nCreated super admin: ${email}`);

    if (!provided) {
      console.log(`\n  Password: ${password}\n`);
      console.log('  This is shown once and is not recoverable. Store it now.');
    }

    console.log(
      '\nSign in at the admin console. Two-factor enrolment is required before the\n' +
        'account can do anything — that is enforced by the API, not the console.\n',
    );
  } finally {
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  }
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

await main();
