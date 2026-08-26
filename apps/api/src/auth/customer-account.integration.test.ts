import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { CustomerAccountService } from './customer-account.service.js';
import type { TokenService } from './token.service.js';
import type { AccessTokenClaims } from './token.service.js';

/**
 * `GET /auth/me/profile` — the customer's own profile and handoff §6's sidebar counters.
 *
 * Against a real PostgreSQL because every interesting part is SQL: two counting subqueries and a left
 * join that has to distinguish "no wallet" from "a balance of zero". A mock would assert the shape of
 * the code rather than what the database answers.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const USER_ID = '99990000-0000-0000-0000-0000000000f1';
const PROFILE_ID = '99990000-0000-0000-0000-0000000000f2';
const OTHER_USER_ID = '99990000-0000-0000-0000-0000000000f3';
const OTHER_PROFILE_ID = '99990000-0000-0000-0000-0000000000f4';
const PARTNER_ID = '99990000-0000-0000-0000-0000000000f5';
const PROPERTY_ID = '99990000-0000-0000-0000-0000000000f6';
const UNIT_ID = '99990000-0000-0000-0000-0000000000f7';
/** `partners.user_id` is NOT NULL, so the fixture partner needs an account of its own. */
const PARTNER_USER_ID = '99990000-0000-0000-0000-0000000000f8';

const customer = (profileId = PROFILE_ID, sub = USER_ID): AccessTokenClaims => ({
  sub,
  role: 'customer',
  permissions: ['review.create'],
  locale: 'ar',
  customerProfileId: profileId,
});

describeIfDb('CustomerAccountService.summary', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: CustomerAccountService;
  /*
    A REAL `PasswordService` — Argon2id, not a stub.

    Verifying the current password is the whole security value of the change endpoint, so a stub that
    answered `true` would leave the one thing worth testing untested.
  */
  const passwords = new PasswordService();
  /*
    `revokeAllForUser` reaches Redis, which a rollback-harness test has no access to. Spied rather
    than stubbed silently: that every session dies is a security PROPERTY, so the calls are recorded
    and asserted.
  */
  let revoked: string[] = [];
  const tokens = {
    revokeAllForUser: (userId: string) => {
      revoked.push(userId);

      return Promise.resolve();
    },
  } as unknown as TokenService;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    revoked = [];
    service = new CustomerAccountService(db, passwords, tokens, new AuditService(db));
    await seed(db);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('answers the profile the token names, with the fields the session cannot carry', async () => {
    const view = await service.summary(customer());

    /* The name is the whole point: §6 greets by it and no token claim holds it. */
    expect(view.fullName).toBe('رامي');
    expect(view.email).toBe('rami@safra.test');
    expect(view.phone).toBe('+963900000010');
    expect(view.reference).toMatch(/^CUS-/);
  });

  it('counts this customer’s bookings and unreviewed stays', async () => {
    const view = await service.summary(customer());

    /* Two bookings seeded, one of them a completed stay with no review yet. */
    expect(view.counters.bookings).toBe(2);
    expect(view.counters.pendingReviews).toBe(1);
  });

  /**
   * A review makes the prompt disappear, and the badge with it.
   *
   * The counter uses the same predicate as `pendingForCustomer`, which is the point of the assertion:
   * a badge that disagreed with the list it points at is worse than no badge.
   */
  it('stops counting a stay once it has been reviewed', async () => {
    const { sql } = await import('drizzle-orm');

    await db.execute(sql`
      INSERT INTO reviews (booking_id, property_id, unit_id, partner_id,
                           customer_profile_id, rating, body)
      SELECT b.id, b.property_id, b.unit_id, b.partner_id, b.customer_profile_id, 5, 'جيد جداً'
      FROM bookings b
      WHERE b.customer_profile_id = ${PROFILE_ID}::uuid AND b.status = 'completed'
      LIMIT 1`);

    const view = await service.summary(customer());

    expect(view.counters.pendingReviews).toBe(0);
    /* The booking itself is still theirs — only the REVIEW prompt went away. */
    expect(view.counters.bookings).toBe(2);
  });

  /**
   * No wallet is absent, not zero.
   *
   * A customer who has never been compensated has no `wallets` row, and «0» on the sidebar would
   * state a balance nobody holds. The badge should be missing instead.
   */
  it('reports no wallet as absent rather than as a zero balance', async () => {
    const view = await service.summary(customer());

    expect(view.counters.walletBalance).toBeNull();
    expect(view.counters.walletCurrency).toBeNull();
  });

  it('reports a real balance with its currency once a wallet exists', async () => {
    const { sql } = await import('drizzle-orm');

    await db.execute(sql`
      INSERT INTO wallets (customer_profile_id, balance, currency_id)
      SELECT ${PROFILE_ID}::uuid, '35.000', cu.id FROM currencies cu WHERE cu.code = 'USD' LIMIT 1`);

    const view = await service.summary(customer());

    expect(view.counters.walletBalance).toBe('35.000');
    expect(view.counters.walletCurrency).toBe('USD');
  });

  /**
   * The counters are scoped to the caller, and the endpoint takes no id to argue with.
   *
   * The second profile has its own booking; neither customer's numbers may include it.
   */
  it('never counts another customer’s bookings', async () => {
    const mine = await service.summary(customer());
    const theirs = await service.summary(customer(OTHER_PROFILE_ID, OTHER_USER_ID));

    expect(mine.counters.bookings).toBe(2);
    expect(theirs.counters.bookings).toBe(1);
    expect(theirs.fullName).toBe('سامر');
  });

  /**
   * A principal with no customer profile gets the same answer as a deleted one.
   *
   * Staff hold no `customerProfileId`. Distinguishing "you are not a customer" from "no such profile"
   * would tell a caller which kind of token they are holding, which is not information this endpoint
   * owes anybody.
   */
  it('refuses a token that carries no customer profile', async () => {
    const staff: AccessTokenClaims = {
      sub: USER_ID,
      role: 'support_agent',
      permissions: [],
      locale: 'ar',
    };

    /*
      Asserted on the CODE, not the sentence.

      The English `message` travels for logs only and is never shown — a client resolves
      `customer.not_found` through the catalogue in the reader's language. Matching the prose would
      make this test fail on a wording change that altered no behaviour, which is what it did first
      time round: the message is "No such customer profile.", not "not found".
    */
    await expect(service.summary(staff)).rejects.toMatchObject({
      response: { code: 'customer.not_found' },
    });
  });

  describe('updateProfile', () => {
    it('changes the name and leaves the phone alone', async () => {
      const result = await service.updateProfile(customer(), { fullName: 'رامي الجديد' });

      expect(result).toStrictEqual({ fullName: 'رامي الجديد', phone: '+963900000010' });
      await expect(service.summary(customer())).resolves.toMatchObject({
        fullName: 'رامي الجديد',
        phone: '+963900000010',
      });
    });

    it('changes the phone and leaves the name alone', async () => {
      const result = await service.updateProfile(customer(), { phone: '+963900000099' });

      expect(result).toStrictEqual({ fullName: 'رامي', phone: '+963900000099' });
    });

    it('changes both when both are given', async () => {
      const result = await service.updateProfile(customer(), {
        fullName: 'سامي',
        phone: '+963900000098',
      });

      expect(result).toStrictEqual({ fullName: 'سامي', phone: '+963900000098' });
    });

    /**
     * The write is scoped by the CLAIM, so it cannot reach across accounts.
     *
     * The endpoint accepts no customer id at all; this proves the `WHERE` honours the one in the token
     * rather than updating by name or by chance.
     */
    it('never touches another customer’s profile', async () => {
      await service.updateProfile(customer(), { fullName: 'رامي المعدل' });

      await expect(
        service.summary(customer(OTHER_PROFILE_ID, OTHER_USER_ID)),
      ).resolves.toMatchObject({ fullName: 'سامر' });
    });

    /**
     * Audited — and the phone's VALUE is not in the audit row.
     *
     * An audit trail records that a contact detail changed, not what it changed to: it is read by
     * support staff and is not a place to accumulate a directory of customer phone numbers.
     */
    it('records the change without recording the phone number', async () => {
      await service.updateProfile(customer(), {
        fullName: 'رامي',
        phone: '+963900000097',
      });

      const rows = await db.execute<{ action: string; after: unknown }>(sql`
        SELECT action, after FROM audit_log
        WHERE actor_user_id = ${USER_ID}::uuid AND action = 'customer.profile_updated'
        ORDER BY created_at DESC LIMIT 1`);

      expect(rows.rows[0]?.action).toBe('customer.profile_updated');
      expect(JSON.stringify(rows.rows[0]?.after)).not.toContain('963900000097');
      expect(JSON.stringify(rows.rows[0]?.after)).toContain('phoneChanged');
    });

    it('refuses a token carrying no customer profile', async () => {
      const staff: AccessTokenClaims = {
        sub: USER_ID,
        role: 'support_agent',
        permissions: [],
        locale: 'ar',
      };

      await expect(
        service.updateProfile(staff, { fullName: 'لا' }),
      ).rejects.toMatchObject({ response: { code: 'customer.not_found' } });
    });

    it('refuses an unauthenticated caller', async () => {
      await expect(
        service.updateProfile(undefined, { fullName: 'لا' }),
      ).rejects.toThrow();
    });
  });

  describe('changePassword', () => {
    const CURRENT = 'a-current-password-1';
    const NEXT = 'a-brand-new-password-2';

    beforeEach(async () => {
      const digest = await passwords.hash(CURRENT);

      await db.execute(sql`
        UPDATE users SET password_hash = ${digest} WHERE id = ${USER_ID}::uuid`);
    });

    /** Reads the stored digest, so the assertions are about what a future sign-in would accept. */
    async function storedDigest(): Promise<string> {
      const rows = await db.execute<{ password_hash: string }>(sql`
        SELECT password_hash FROM users WHERE id = ${USER_ID}::uuid`);

      return rows.rows[0]?.password_hash ?? '';
    }

    it('replaces the password, so the old one stops working and the new one starts', async () => {
      await service.changePassword(customer(), {
        currentPassword: CURRENT,
        newPassword: NEXT,
      });

      const digest = await storedDigest();

      await expect(passwords.verify(digest, NEXT)).resolves.toBe(true);
      await expect(passwords.verify(digest, CURRENT)).resolves.toBe(false);
    });

    /**
     * Every session dies, including the caller's.
     *
     * People change a password because they believe somebody else has it; leaving that person's refresh
     * tokens alive hands the account straight back.
     */
    it('revokes every session for the user', async () => {
      await service.changePassword(customer(), {
        currentPassword: CURRENT,
        newPassword: NEXT,
      });

      expect(revoked).toStrictEqual([USER_ID]);
    });

    /** THE control: a leaked access token is not enough without the present password. */
    it('refuses a wrong current password and leaves the stored one untouched', async () => {
      const before = await storedDigest();

      await expect(
        service.changePassword(customer(), {
          currentPassword: 'not-the-current-one',
          newPassword: NEXT,
        }),
      ).rejects.toMatchObject({ response: { code: 'auth.password_incorrect' } });

      expect(await storedDigest()).toBe(before);
      /* And no session was revoked, because nothing changed. */
      expect(revoked).toStrictEqual([]);
    });

    /** A refusal is recorded: repeated ones are somebody guessing at an unlocked screen. */
    it('records a refused attempt', async () => {
      await expect(
        service.changePassword(customer(), {
          currentPassword: 'wrong',
          newPassword: NEXT,
        }),
      ).rejects.toThrow();

      const rows = await db.execute<{ action: string }>(sql`
        SELECT action FROM audit_log
        WHERE actor_user_id = ${USER_ID}::uuid AND action = 'auth.password_change_refused'`);

      expect(rows.rows).toHaveLength(1);
    });

    it('records a successful change', async () => {
      await service.changePassword(customer(), {
        currentPassword: CURRENT,
        newPassword: NEXT,
      });

      const rows = await db.execute<{ action: string }>(sql`
        SELECT action FROM audit_log
        WHERE actor_user_id = ${USER_ID}::uuid AND action = 'auth.password_changed'`);

      expect(rows.rows).toHaveLength(1);
    });

    /** A deliberate change by somebody who proved the old password clears a lockout, as a reset does. */
    it('clears a lockout and the failed-attempt counter', async () => {
      await db.execute(sql`
        UPDATE users
        SET failed_login_attempts = 4, locked_until = now() + interval '10 minute'
        WHERE id = ${USER_ID}::uuid`);

      await service.changePassword(customer(), {
        currentPassword: CURRENT,
        newPassword: NEXT,
      });

      const rows = await db.execute<{ attempts: number; locked: string | null }>(sql`
        SELECT failed_login_attempts AS attempts, locked_until::text AS locked
        FROM users WHERE id = ${USER_ID}::uuid`);

      expect(rows.rows[0]?.attempts).toBe(0);
      expect(rows.rows[0]?.locked).toBeNull();
    });

    /**
     * An account with no password at all — a claimed guest profile — cannot "change" one.
     *
     * Answered identically to a wrong password: there is no current password to prove, and saying which
     * of the two it is would describe the account to whoever is asking.
     */
    it('refuses an account that has no password set', async () => {
      await db.execute(sql`
        UPDATE users SET password_hash = NULL WHERE id = ${USER_ID}::uuid`);

      await expect(
        service.changePassword(customer(), {
          currentPassword: CURRENT,
          newPassword: NEXT,
        }),
      ).rejects.toMatchObject({ response: { code: 'auth.password_incorrect' } });
    });

    it('refuses an unauthenticated caller', async () => {
      await expect(
        service.changePassword(undefined, {
          currentPassword: CURRENT,
          newPassword: NEXT,
        }),
      ).rejects.toThrow();
    });
  });

  it('refuses an unauthenticated caller', async () => {
    await expect(service.summary(undefined)).rejects.toThrow();
  });
});

async function seed(db: Database): Promise<void> {
  const { sql } = await import('drizzle-orm');

  for (const [userId, email] of [
    [USER_ID, 'rami@safra.test'],
    [OTHER_USER_ID, 'samer@safra.test'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO users (id, email, role) VALUES (${userId}::uuid, ${email}, 'customer')
      ON CONFLICT DO NOTHING`);
  }

  await db.execute(sql`
    INSERT INTO users (id, email, role)
    VALUES (${PARTNER_USER_ID}::uuid, 'account-test-partner@safra.test', 'partner')
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO customer_profiles (id, user_id, full_name, email, phone, is_guest)
    VALUES (${PROFILE_ID}::uuid, ${USER_ID}::uuid, 'رامي', 'rami@safra.test',
            '+963900000010', false)
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO customer_profiles (id, user_id, full_name, email, phone, is_guest)
    VALUES (${OTHER_PROFILE_ID}::uuid, ${OTHER_USER_ID}::uuid, 'سامر', 'samer@safra.test',
            '+963900000011', false)
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO partners (id, user_id, partner_type_id, legal_name, display_name, city_id,
                          address, phone, email)
    SELECT ${PARTNER_ID}::uuid, ${PARTNER_USER_ID}::uuid, pt.id, 'Acc Test', 'حساب', c.id,
           'Addr', '+963900000012', 'account-test@safra.test'
    FROM partner_types pt, cities c
    WHERE pt.code = 'accommodation' AND c.slug = 'damascus'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO properties (id, partner_id, city_id, property_type_id, slug,
                            name_ar, name_en, name_de, address, cancellation_policy_id, status)
    SELECT ${PROPERTY_ID}::uuid, ${PARTNER_ID}::uuid, c.id, pt.id, 'account-test-property',
           'اختبار الحساب', 'Account Test', 'Kontotest', 'Addr', cp.id, 'draft'
    FROM cities c, property_types pt, cancellation_policies cp
    WHERE c.slug = 'damascus' AND pt.code = 'apartment' AND cp.code = 'flex'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO units (id, property_id, name_ar, name_en, name_de, max_guests,
                       base_price, currency_id, min_nights)
    SELECT ${UNIT_ID}::uuid, ${PROPERTY_ID}::uuid, 'وحدة', 'Unit', 'Einheit', 2, 80, cu.id, 1
    FROM currencies cu WHERE cu.code = 'USD'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  /* Two bookings for the first customer — one completed and unreviewed, one still pending. */
  await booking(db, PROFILE_ID, 'completed');
  await booking(db, PROFILE_ID, 'pending_payment');
  /* One for the second, which must never appear in the first's counters. */
  await booking(db, OTHER_PROFILE_ID, 'completed');
}

/** The booking fixture the dashboard suite uses, reduced to what these counters read. */
async function booking(db: Database, profileId: string, status: string): Promise<void> {
  const { sql } = await import('drizzle-orm');

  await db.execute(sql`
    INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                          check_in, check_out, guests_adults, status,
                          base_amount, customer_fee_value, customer_fee_amount,
                          partner_commission_rate, partner_commission_amount,
                          total_amount, partner_payable_amount, currency_id,
                          fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
    SELECT ${profileId}::uuid, un.id, un.property_id, pr.partner_id, pr.city_id,
           '2030-05-01'::date, '2030-05-03'::date, 2, ${status}::booking_status,
           '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
           un.currency_id, '12500.00000000', '2524875.00', '{"code":"flex"}'::jsonb
    FROM units un JOIN properties pr ON pr.id = un.property_id
    WHERE un.id = ${UNIT_ID}::uuid`);
}
