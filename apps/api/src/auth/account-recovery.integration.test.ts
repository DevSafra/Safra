import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import { AuthTokenService } from './auth-token.service.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import type { MailService, OutgoingMail } from '../mail/mail.service.js';
import type { TokenService } from './token.service.js';

/**
 * Password reset, email verification and guest-booking claiming, against a REAL
 * PostgreSQL.
 *
 * These are the flows an attacker reaches for first, and most of what makes them
 * safe lives in SQL: the conditional UPDATE that makes a token single-use even under
 * a race, the supersede-on-issue that stops three "resend" clicks leaving three live
 * keys, and the claim query that must move bookings only for a VERIFIED address.
 * None of it can be exercised against a mock.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('account recovery', () => {
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let recovery: AccountRecoveryService;
  let authTokens: AuthTokenService;
  let passwords: PasswordService;

  /** Every email the service tried to send, newest last. */
  let outbox: OutgoingMail[];
  /** Users whose sessions were revoked. */
  let revoked: string[];

  let user: { id: string; email: string };

  beforeEach(async () => {
    await harness.begin();

    db = harness.db;

    authTokens = new AuthTokenService(db);
    passwords = new PasswordService();

    const mail = {
      send: (message: OutgoingMail) => {
        outbox.push(message);
        return Promise.resolve();
      },
    } as unknown as MailService;

    /**
     * Session revocation is captured rather than performed. What matters is THAT a
     * completed reset revokes — the mechanism has its own tests — and a real
     * TokenService here would need the whole JWT configuration for no extra coverage.
     */
    const tokens = {
      revokeAllForUser: (id: string) => {
        revoked.push(id);
        return Promise.resolve();
      },
    } as unknown as TokenService;

    /**
     * A REAL WalletService, with FX stubbed to throw.
     *
     * Real, because carrying a guest balance across is the part most likely to be
     * silently wrong and the row lock and append-only trail are the whole point.
     * FX throws because every wallet here is USD: a conversion would mean the
     * same-currency path had been skipped, and a loud failure says so.
     */
    /*
      A rate IS needed now, and not for a conversion.

      This stub threw on any call, on the premise that a same-currency transfer never consults FX.
      That stopped being true when the claim started posting ledger legs: every ledger entry carries
      `amount_syp`, so the group needs the rate whatever the currencies are. The stub still proves
      the original point — it answers only for USD, so a conversion between two different currencies
      would still fail loudly here.
    */
    const fxStub = {
      rateToSyp: (code: string) => {
        if (code !== 'USD') {
          throw new Error(
            `FX must not be consulted for ${code} — every wallet here is USD.`,
          );
        }

        return Promise.resolve('13000.00000000');
      },
      decimalsOf: () => Promise.resolve(2),
    } as unknown as FxRateService;

    const wallet = new WalletService(db, fxStub);

    recovery = new AccountRecoveryService(
      db,
      { APP_URL: 'https://safra.test' } as never,
      authTokens,
      passwords,
      tokens,
      mail,
      new AuditService(db),
      wallet,
      new LedgerService(db),
      fxStub,
    );
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    outbox = [];
    revoked = [];
    user = await createUser(db, passwords);
  });

  // ── Requesting a reset ──────────────────────────────────────────────────────

  describe('requesting a password reset', () => {
    it('emails a link containing a usable token', async () => {
      await recovery.requestPasswordReset(user.email, {});

      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.to).toBe(user.email);

      const token = tokenFrom(outbox[0]);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    /**
     * The whole point of the endpoint's shape. An unknown address must be
     * indistinguishable from a known one, or it becomes a customer-list oracle that
     * needs no password guess at all.
     */
    it('says nothing and sends nothing for an unknown address', async () => {
      await expect(
        recovery.requestPasswordReset('nobody-here@safra.test', {}),
      ).resolves.toBeUndefined();

      expect(outbox).toHaveLength(0);
    });

    it('does the same for a suspended account', async () => {
      await db.execute(sql`UPDATE users SET status = 'suspended' WHERE id = ${user.id}`);

      await expect(
        recovery.requestPasswordReset(user.email, {}),
      ).resolves.toBeUndefined();
      expect(outbox).toHaveLength(0);
    });

    it('matches the address case-insensitively', async () => {
      await recovery.requestPasswordReset(user.email.toUpperCase(), {});

      expect(outbox).toHaveLength(1);
    });

    /**
     * Three clicks on "resend" must not leave three live keys to the account. Only
     * the newest link may work.
     */
    it('invalidates the previous link when a new one is issued', async () => {
      await recovery.requestPasswordReset(user.email, {});
      const first = tokenFrom(outbox[0]);

      await recovery.requestPasswordReset(user.email, {});
      const second = tokenFrom(outbox[1]);

      expect(first).not.toBe(second);

      await expect(
        recovery.confirmPasswordReset(first, 'a-brand-new-password', {}),
      ).rejects.toThrow(/invalid or has expired/i);

      await expect(
        recovery.confirmPasswordReset(second, 'a-brand-new-password', {}),
      ).resolves.toBeUndefined();
    });

    /**
     * Per-ACCOUNT throttling, distinct from the per-IP limiter on the route: an
     * attacker cycling addresses could otherwise bury one victim's inbox and drown
     * out a real security notification.
     */
    it('stops emailing one account after five requests in the window', async () => {
      for (let i = 0; i < 7; i += 1) {
        await recovery.requestPasswordReset(user.email, {});
      }

      expect(outbox).toHaveLength(5);
    });
  });

  // ── Completing a reset ──────────────────────────────────────────────────────

  describe('completing a password reset', () => {
    async function requestToken(): Promise<string> {
      await recovery.requestPasswordReset(user.email, {});
      return tokenFrom(outbox.at(-1));
    }

    it('changes the password', async () => {
      const token = await requestToken();

      await recovery.confirmPasswordReset(token, 'my-new-strong-password', {});

      const hash = await currentHash(db, user.id);
      expect(await passwords.verify(hash, 'my-new-strong-password')).toBe(true);
      expect(await passwords.verify(hash, 'the-original-password')).toBe(false);
    });

    /**
     * Someone resets because they believe another person has their password.
     * Leaving that person's refresh tokens alive hands the account straight back.
     */
    it('revokes every existing session', async () => {
      await recovery.confirmPasswordReset(await requestToken(), 'my-new-password-x', {});

      expect(revoked).toStrictEqual([user.id]);
    });

    /** The person locked out by someone else's guessing is the one resetting. */
    it('clears an existing lockout', async () => {
      await db.execute(sql`
        UPDATE users SET failed_login_attempts = 5, locked_until = now() + interval '1 hour'
        WHERE id = ${user.id}`);

      await recovery.confirmPasswordReset(await requestToken(), 'my-new-password-y', {});

      const rows = await db.execute<{ attempts: number; locked: string | null }>(sql`
        SELECT failed_login_attempts AS attempts, locked_until::text AS locked
        FROM users WHERE id = ${user.id}`);

      expect(rows.rows[0]?.attempts).toBe(0);
      expect(rows.rows[0]?.locked).toBeNull();
    });

    it('cannot be used twice', async () => {
      const token = await requestToken();

      await recovery.confirmPasswordReset(token, 'first-new-password', {});

      await expect(
        recovery.confirmPasswordReset(token, 'second-new-password', {}),
      ).rejects.toThrow(/invalid or has expired/i);
    });

    /**
     * Two clicks on the same link, arriving together. Exactly one may win — the
     * conditional UPDATE is what decides, not a read-then-write.
     */
    it('lets exactly one of two concurrent redemptions win', async () => {
      const token = await requestToken();

      const outcomes = await Promise.allSettled([
        recovery.confirmPasswordReset(token, 'concurrent-password-a', {}),
        recovery.confirmPasswordReset(token, 'concurrent-password-b', {}),
      ]);

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    });

    it('rejects an expired token', async () => {
      const token = await requestToken();

      await db.execute(sql`
        UPDATE auth_tokens SET expires_at = now() - interval '1 minute'
        WHERE user_id = ${user.id} AND purpose = 'password_reset'`);

      await expect(
        recovery.confirmPasswordReset(token, 'too-late-password', {}),
      ).rejects.toThrow(/invalid or has expired/i);
    });

    it('rejects a token that was never issued', async () => {
      await expect(
        recovery.confirmPasswordReset('z'.repeat(43), 'some-new-password', {}),
      ).rejects.toThrow(/invalid or has expired/i);
    });

    /**
     * Expired, already used and never valid must all read the same. Distinguishing
     * them tells a guesser which attempt got closer.
     */
    it('reports every failure identically', async () => {
      const used = await requestToken();
      await recovery.confirmPasswordReset(used, 'consumed-password', {});

      const messages = await Promise.all(
        [used, 'q'.repeat(43)].map((t) =>
          recovery
            .confirmPasswordReset(t, 'another-password', {})
            .catch((e: Error) => e.message),
        ),
      );

      expect(new Set(messages).size).toBe(1);
    });

    /** A reset token must not double as an email confirmation. */
    it('cannot be redeemed as a verification token', async () => {
      const token = await requestToken();

      await expect(recovery.confirmEmailVerification(token)).rejects.toThrow(
        /invalid or has expired/i,
      );
    });
  });

  // ── Email verification and claiming ─────────────────────────────────────────

  describe('email verification', () => {
    it('marks the address verified', async () => {
      await recovery.requestEmailVerification(user.id, {});
      await recovery.confirmEmailVerification(tokenFrom(outbox.at(-1)));

      const rows = await db.execute<{ verified: boolean }>(sql`
        SELECT email_verified_at IS NOT NULL AS verified FROM users WHERE id = ${user.id}`);

      expect(rows.rows[0]?.verified).toBe(true);
    });

    it('does not email an already-verified account', async () => {
      await db.execute(
        sql`UPDATE users SET email_verified_at = now() WHERE id = ${user.id}`,
      );

      await recovery.requestEmailVerification(user.id, {});

      expect(outbox).toHaveLength(0);
    });

    /**
     * The reason claiming is gated on verification at all.
     *
     * A guest booking holds someone's travel dates, their phone number and what they
     * paid. If registering with an address were enough to claim it, typing a
     * stranger's email would hand all of that over.
     */
    it('moves guest bookings made with the verified address', async () => {
      const guest = await createGuestBooking(db, user.email);

      await recovery.requestEmailVerification(user.id, {});
      const result = await recovery.confirmEmailVerification(tokenFrom(outbox.at(-1)));

      expect(result.claimedBookings).toBe(1);

      const owner = await bookingOwnerEmail(db, guest.bookingId);
      expect(owner.userId).toBe(user.id);
    });

    it('leaves another person’s guest bookings alone', async () => {
      const stranger = await createGuestBooking(db, 'someone-else@safra.test');

      await recovery.requestEmailVerification(user.id, {});
      const result = await recovery.confirmEmailVerification(tokenFrom(outbox.at(-1)));

      expect(result.claimedBookings).toBe(0);

      const owner = await bookingOwnerEmail(db, stranger.bookingId);
      expect(owner.userId).toBeNull();
    });

    it('claims nothing when the customer booked no stays as a guest', async () => {
      await recovery.requestEmailVerification(user.id, {});
      const result = await recovery.confirmEmailVerification(tokenFrom(outbox.at(-1)));

      expect(result.claimedBookings).toBe(0);
    });

    /**
     * The part that is easy to forget and expensive to miss.
     *
     * §6.4 credits SLA compensation to whichever profile made the booking, including
     * a guest one. Moving the bookings but not the money would strand real
     * compensation on a profile the customer can no longer reach.
     */
    it('carries a guest wallet balance across to the account', async () => {
      const guest = await createGuestBooking(db, user.email);
      await fundWallet(db, guest.profileId, '30.000');

      await recovery.requestEmailVerification(user.id, {});
      await recovery.confirmEmailVerification(tokenFrom(outbox.at(-1)));

      expect(await balanceOf(db, guest.profileId)).toBe('0.000');
      expect(await balanceOfUser(db, user.id)).toBe('30.000');
    });

    it('adds the carried balance to one the account already had', async () => {
      const guest = await createGuestBooking(db, user.email);
      await fundWallet(db, guest.profileId, '30.000');
      await fundWalletOfUser(db, user.id, '12.50');

      await recovery.requestEmailVerification(user.id, {});
      await recovery.confirmEmailVerification(tokenFrom(outbox.at(-1)));

      expect(await balanceOfUser(db, user.id)).toBe('42.500');
    });

    /**
     * The transfer is in the LEDGER, not only in the two wallets (Bashar, 2026-08-26).
     *
     * It was argued off the books on the grounds that a claim changes nothing SAFRA owes — the
     * same money, the same person, a different profile. That is true of the TOTAL and beside the
     * point: an account is how a movement is traced, and «where did this balance come from» had no
     * answer in the ledger at all. 36 movements had already been made this way.
     *
     * The group balances to zero in SYP, which is the shape a transfer should have — liability
     * leaves one wallet and arrives at another.
     */
    it('posts a balanced ledger group for the transfer', async () => {
      const guest = await createGuestBooking(db, user.email);

      await fundWallet(db, guest.profileId, '30.000');

      await recovery.requestEmailVerification(user.id, {});
      await recovery.confirmEmailVerification(tokenFrom(outbox.at(-1)));

      const legs = await db.execute<{
        account: string;
        direction: string;
        amount: string;
        amount_syp: string;
        group: string;
      }>(sql`
        SELECT l.account::text, l.direction::text, l.amount::text,
               l.amount_syp::text, l.entry_group_id::text AS group
        FROM ledger_entries l
        JOIN customer_profiles c ON c.id = l.customer_profile_id
        JOIN users u ON u.id = c.user_id
        WHERE u.id = ${user.id}::uuid
          AND l.account IN ('wallet_debit', 'wallet_credit')
        /* By the TEXT, not the enum: an enum orders by declaration, which is not obvious here. */
        ORDER BY l.account::text
      `);

      const rows = legs.rows;

      expect(rows, 'a group was posted at all').toHaveLength(2);
      /* One group, or they are not two legs of one movement. */
      expect(new Set(rows.map((leg) => leg.group)).size).toBe(1);

      expect(rows.map((leg) => `${leg.account}:${leg.direction}`)).toStrictEqual([
        'wallet_credit:credit',
        'wallet_debit:debit',
      ]);

      for (const leg of rows) {
        expect(Number(leg.amount), 'each leg is the balance that moved').toBe(30);
      }

      /*
        Net zero in SYP — the unit the balance trigger checks, and the reason this movement is
        allowed to be on the books at all without changing what SAFRA owes.
      */
      const net = rows.reduce(
        (sum, leg) => sum + (leg.direction === 'debit' ? 1 : -1) * Number(leg.amount_syp),
        0,
      );

      expect(net, 'a transfer nets to nothing').toBe(0);
    });

    it('leaves an empty guest wallet alone rather than writing a zero movement', async () => {
      const guest = await createGuestBooking(db, user.email);

      await recovery.requestEmailVerification(user.id, {});
      await recovery.confirmEmailVerification(tokenFrom(outbox.at(-1)));

      const movements = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count FROM wallet_transactions wt
        JOIN wallets w ON w.id = wt.wallet_id
        WHERE w.customer_profile_id = ${guest.profileId}`);

      expect(movements.rows[0]?.count).toBe('0');
    });

    /** Re-verifying must not re-run the claim or double-count it. */
    it('is idempotent across a second verification', async () => {
      await createGuestBooking(db, user.email);

      await recovery.requestEmailVerification(user.id, {});
      await recovery.confirmEmailVerification(tokenFrom(outbox.at(-1)));

      await db.execute(
        sql`UPDATE users SET email_verified_at = NULL WHERE id = ${user.id}`,
      );
      await recovery.requestEmailVerification(user.id, {});
      const second = await recovery.confirmEmailVerification(tokenFrom(outbox.at(-1)));

      expect(second.claimedBookings).toBe(0);
    });
  });
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * A fresh customer per test.
 *
 * Not cleaned up: `audit_log` is append-only by trigger and references these users,
 * so they cannot be deleted. CI runs against a fresh database; locally the residue is
 * namespaced `recovery-test-*@safra.test`.
 */
async function createUser(
  db: Database,
  passwords: PasswordService,
): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `recovery-test-${id.slice(0, 8)}@safra.test`;
  const hash = await passwords.hash('the-original-password');

  await db.execute(sql`
    INSERT INTO users (id, email, password_hash, role, preferred_locale)
    VALUES (${id}::uuid, ${email}, ${hash}, 'customer', 'en')`);

  await db.execute(sql`
    INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
    VALUES (${id}::uuid, 'Recovery Test', ${email}, '+963900000010', false)`);

  return { id, email };
}

/** Gives a profile a wallet with a balance, as the SLA sweep would. */
async function fundWallet(
  db: Database,
  profileId: string,
  amount: string,
): Promise<void> {
  await db.execute(sql`
    WITH w AS (
      INSERT INTO wallets (customer_profile_id, balance, currency_id)
      SELECT ${profileId}::uuid, ${amount}::numeric, cu.id
      FROM currencies cu WHERE cu.code = 'USD'
      ON CONFLICT DO NOTHING
      RETURNING id, currency_id
    )
    INSERT INTO wallet_transactions
      (wallet_id, direction, reason, amount, currency_id, balance_after)
    SELECT w.id, 'credit', 'sla_compensation', ${amount}::numeric, w.currency_id,
           ${amount}::numeric
    FROM w`);
}

async function fundWalletOfUser(
  db: Database,
  userId: string,
  amount: string,
): Promise<void> {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM customer_profiles WHERE user_id = ${userId} AND deleted_at IS NULL`,
  );

  const profileId = rows.rows[0]?.id;
  if (!profileId) throw new Error('User has no customer profile.');

  await fundWallet(db, profileId, amount);
}

async function balanceOf(db: Database, profileId: string): Promise<string> {
  const rows = await db.execute<{ balance: string }>(sql`
    SELECT balance::text AS balance FROM wallets
    WHERE customer_profile_id = ${profileId} AND deleted_at IS NULL`);

  return rows.rows[0]?.balance ?? 'no wallet';
}

async function balanceOfUser(db: Database, userId: string): Promise<string> {
  const rows = await db.execute<{ balance: string }>(sql`
    SELECT w.balance::text AS balance FROM wallets w
    JOIN customer_profiles cp ON cp.id = w.customer_profile_id
    WHERE cp.user_id = ${userId} AND w.deleted_at IS NULL`);

  return rows.rows[0]?.balance ?? 'no wallet';
}

/** A booking made with no account, exactly as guest checkout leaves it. */
async function createGuestBooking(
  db: Database,
  email: string,
): Promise<{ bookingId: string; profileId: string }> {
  const profileId = randomUUID();
  const bookingId = randomUUID();
  const unitId = randomUUID();

  await db.execute(sql`
    INSERT INTO customer_profiles (id, user_id, full_name, email, phone, is_guest)
    VALUES (${profileId}::uuid, NULL, 'Guest Booker', ${email}, '+963900000011', true)`);

  await db.execute(sql`
    INSERT INTO units (id, property_id, name_ar, name_en, name_de, max_guests,
                       base_price, currency_id, min_nights)
    SELECT ${unitId}::uuid, p.id, 'وحدة', 'Unit', 'Einheit', 4, 50, cu.id, 1
    FROM properties p, currencies cu
    WHERE cu.code = 'USD' LIMIT 1`);

  await db.execute(sql`
    INSERT INTO bookings (
      id, reference, customer_profile_id, unit_id, property_id, partner_id, city_id,
      check_in, check_out, guests_adults, status,
      base_amount, customer_fee_mode, customer_fee_value, customer_fee_amount,
      partner_commission_rate, partner_commission_amount, total_amount,
      partner_payable_amount, currency_id, fx_rate_to_syp, total_syp,
      cancellation_policy_snapshot)
    SELECT ${bookingId}::uuid, ${`BKG-CLAIM-${bookingId.slice(0, 6)}`},
           ${profileId}::uuid, ${unitId}::uuid, p.id, p.partner_id, p.city_id,
           (now() + interval '40 days')::date, (now() + interval '43 days')::date, 2,
           'confirmed',
           150.00, 'flat', 1.99, 1.99, 0.07, 10.50, 151.99, 139.50,
           cu.id, 13000.00000000, 1975870.00, '{}'::jsonb
    FROM properties p, currencies cu
    WHERE p.id = (SELECT property_id FROM units WHERE id = ${unitId}::uuid)
      AND cu.code = 'USD' LIMIT 1`);

  return { bookingId, profileId };
}

async function bookingOwnerEmail(
  db: Database,
  bookingId: string,
): Promise<{ userId: string | null }> {
  const rows = await db.execute<{ user_id: string | null }>(sql`
    SELECT cp.user_id FROM bookings b
    JOIN customer_profiles cp ON cp.id = b.customer_profile_id
    WHERE b.id = ${bookingId}::uuid`);

  return { userId: rows.rows[0]?.user_id ?? null };
}

async function currentHash(db: Database, userId: string): Promise<string> {
  const rows = await db.execute<{ password_hash: string }>(
    sql`SELECT password_hash FROM users WHERE id = ${userId}`,
  );

  return rows.rows[0]?.password_hash ?? '';
}

/** Pulls the token out of the emailed link, the way a customer's click would. */
function tokenFrom(mail: OutgoingMail | undefined): string {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? '');

  if (!match?.[1]) throw new Error('No token in the email body.');

  return match[1];
}
