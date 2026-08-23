import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR, type PartnerApplicationInput } from '@safra/contracts';

import type { AuditService } from '../common/audit/audit.service.js';
import type { AuthTokenService } from '../auth/auth-token.service.js';
import type { Env } from '../config/env.js';
import type { MailService, OutgoingMail } from '../mail/mail.service.js';
import type { PasswordService } from '../common/crypto/password.service.js';
import type { TokenService } from '../auth/token.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { PartnerApplicationService } from './partner-application.service.js';
import { PartnerInvitationService } from './partner-invitation.service.js';

/**
 * «انضم كشريك», against a real PostgreSQL.
 *
 * Almost everything worth asserting here is a rule about WHO ends up holding a partner account,
 * and every one of those rules is expressed in SQL or in a decision made from a row — a partial
 * unique index, an `EXISTS` over `partners`, a role read at redemption. None of it can be
 * exercised against a mocked database, which is why this is an integration test rather than a
 * unit one.
 *
 * Skipped when `DATABASE_URL` is unset so local `pnpm test` stays fast.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const STAFF_USER_ID = '99990000-0000-0000-0000-0000000000a1';
const CUSTOMER_USER_ID = '99990000-0000-0000-0000-0000000000a2';
const SECOND_CUSTOMER_USER_ID = '99990000-0000-0000-0000-0000000000a6';
const EXISTING_PARTNER_USER_ID = '99990000-0000-0000-0000-0000000000a3';
const EXISTING_PARTNER_ID = '99990000-0000-0000-0000-0000000000a4';
const REVIEWER_ID = '99990000-0000-0000-0000-0000000000a5';

const STAFF_EMAIL = 'application-test-staff@safra.test';
const CUSTOMER_EMAIL = 'application-test-customer@safra.test';
const EXISTING_PARTNER_EMAIL = 'application-test-partner@safra.test';
const SECOND_CUSTOMER_EMAIL = 'application-test-customer-2@safra.test';

const reviewer: AccessTokenClaims = {
  sub: REVIEWER_ID,
  role: 'super_admin',
  permissions: ['partner_application.read', 'partner_application.manage'],
  locale: 'ar',
};

/*
  `{ response: { code } }`, not `{ code }`.

  `app-error.ts` throws Nest exceptions whose BODY carries the code — `{ statusCode, code, message }`
  — so the code is one level down. Asserted on the code and never on the message: the message is
  English text for logs, and a test that pinned it would break every time the wording improved.
*/

/**
 * A complete, valid application.
 *
 * No `email`: since 2026-08-19 applying requires a session and the address is the ACCOUNT's, so
 * which mailbox a request belongs to is chosen by `submit`'s `userId`, not by this object.
 */
const application = (
  overrides: Partial<PartnerApplicationInput> = {},
): PartnerApplicationInput => ({
  contactName: 'أبو محمد',
  phone: '+963116414444',
  legalName: 'شركة اختبار الشراكة',
  displayName: 'فندق الاختبار',
  partnerTypeCode: 'accommodation',
  citySlug: 'damascus',
  address: 'شارع الاختبار 1',
  preferredLocale: 'ar',
  ...overrides,
});

describeIfDb('PartnerApplicationService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: PartnerApplicationService;
  let sent: OutgoingMail[];
  let issued: { userId: string; purpose: string }[];
  let revoked: string[];

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    sent = [];
    issued = [];
    revoked = [];

    const audit = { record: () => Promise.resolve() } as unknown as AuditService;

    const mail = {
      send: (message: OutgoingMail) => {
        sent.push(message);

        return Promise.resolve();
      },
    } as unknown as MailService;

    /* A fake token service, so a test can assert WHICH account an invitation was issued against. */
    const authTokens = {
      issue: (userId: string, purpose: string) => {
        issued.push({ userId, purpose });

        return Promise.resolve({ token: `token-for-${userId}` });
      },
      redeem: (token: string, purpose: string) => {
        const match = /^token-for-(.+)$/.exec(token);

        return Promise.resolve(
          match && purpose === 'partner_invitation'
            ? { userId: match[1], email: '', preferredLocale: 'ar' }
            : null,
        );
      },
    } as unknown as AuthTokenService;

    const passwords = {
      hash: () => Promise.resolve('$argon2id$fake'),
    } as unknown as PasswordService;

    const tokens = {
      revokeAllForUser: (userId: string) => {
        revoked.push(userId);

        return Promise.resolve();
      },
    } as unknown as TokenService;

    const env = {
      APP_URL: 'https://safra.test',
      PARTNER_URL: 'https://partner.safra.test',
    } as unknown as Env;

    /*
      The real invitation service, over the same fake token service and mailbox.

      Constructed rather than stubbed on purpose: it is the thing that decides an invitation's
      lifetime and the URL it points at, and the assertions below read both out of `sent`. A stub
      here would let those two facts change without a single test noticing.
    */
    const invitations = new PartnerInvitationService(authTokens, mail, env);

    service = new PartnerApplicationService(
      db,
      audit,
      authTokens,
      mail,
      passwords,
      tokens,
      env,
      invitations,
    );

    await seed(db);
  });

  afterEach(async () => {
    await harness.rollback();
    vi.restoreAllMocks();
  });

  describe('submitting', () => {
    it('records the request against the account that filed it, changing nothing about it', async () => {
      const result = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      expect(result.reference).toMatch(/^PRQ-\d{6,}$/);

      const row = await db.execute<{ submitted_by: string; email: string }>(sql`
        SELECT submitted_by_user_id AS submitted_by, email FROM partner_applications
        WHERE reference = ${result.reference}
      `);

      /* The account, and ITS address — neither of which the caller supplied. */
      expect(row.rows[0]?.submitted_by).toBe(CUSTOMER_USER_ID);
      expect(row.rows[0]?.email).toBe(CUSTOMER_EMAIL);

      /* Applying is not a change to your account. Filing one leaves it exactly as it was. */
      const account = await db.execute<{
        role: string;
        password_hash: string | null;
      }>(sql`
        SELECT role::text AS role, password_hash FROM users WHERE id = ${CUSTOMER_USER_ID}::uuid
      `);

      expect(account.rows[0]?.role).toBe('customer');
      expect(account.rows[0]?.password_hash).toBe('$argon2id$existing');
    });

    /** The applicant is told the number to quote, and nothing about the queue. */
    it('answers with the reference alone', async () => {
      const result = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      expect(Object.keys(result)).toStrictEqual(['reference']);
    });

    it('acknowledges by email, in the language the form was filled in', async () => {
      await service.submit(application({ preferredLocale: 'de' }), {
        userId: CUSTOMER_USER_ID,
      });

      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe(CUSTOMER_EMAIL);
      expect(sent[0]?.subject).toContain('Partneranfrage');
      /* The reference is IN the mail — it is the only copy the applicant gets. */
      expect(sent[0]?.text).toMatch(/PRQ-\d{6,}/);
    });

    /**
     * One open request per address.
     *
     * Enforced by a partial unique index as well as by this check, because two forms submitted in
     * the same second would both pass the check and only one can win at the database.
     */
    it('refuses a second open request from the same address', async () => {
      await service.submit(application(), { userId: CUSTOMER_USER_ID });

      await expect(
        service.submit(application(), { userId: CUSTOMER_USER_ID }),
      ).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_APPLICATION_ALREADY_OPEN },
      });
    });

    /** One open request per ACCOUNT, not per business — a second account may still apply. */
    it('lets a different account apply while one request is open', async () => {
      await service.submit(application(), { userId: CUSTOMER_USER_ID });

      const other = await service.submit(application(), {
        userId: SECOND_CUSTOMER_USER_ID,
      });

      expect(other.reference).toMatch(/^PRQ-\d{6,}$/);
    });

    /** A rejected applicant fixed whatever was wrong and came back. That must work. */
    it('lets a rejected applicant apply again', async () => {
      const first = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      await service.reject(reviewer, first.reference, 'مستندات ناقصة');

      const second = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      expect(second.reference).not.toBe(first.reference);
    });

    it('refuses a partner type or a city that does not exist', async () => {
      await expect(
        service.submit(application({ partnerTypeCode: 'not-a-type' }), {
          userId: CUSTOMER_USER_ID,
        }),
      ).rejects.toMatchObject({ response: { code: ERROR.PARTNER_TYPE_UNKNOWN } });

      await expect(
        service.submit(application({ citySlug: 'not-a-city' }), {
          userId: CUSTOMER_USER_ID,
        }),
      ).rejects.toMatchObject({ response: { code: ERROR.GEO_CITY_UNKNOWN } });
    });
  });

  describe('the queue', () => {
    it('pages, filters by status and searches by reference or business name', async () => {
      const first = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      await service.submit(application({ displayName: 'نُزل آخر' }), {
        userId: SECOND_CUSTOMER_USER_ID,
      });

      const all = await service.list({ page: 1, limit: 10 });

      expect(all.items.length).toBeGreaterThanOrEqual(2);

      await service.markContacted(reviewer, first.reference, 'اتصلنا اليوم');

      const contacted = await service.list({ page: 1, limit: 10, status: 'contacted' });

      /*
        Contains it, and everything returned IS contacted — not "returns exactly this one".

        The testbed seeds a request in each state so the console's four statuses have four colours
        to show, and those rows are committed rather than written by this test. Exact equality
        passed only while the fixture happened to be empty, which is the kind of test that fails
        for a reason unrelated to the change that broke it.
      */
      expect(contacted.items.map((row) => row.reference)).toContain(first.reference);
      expect(contacted.items.every((row) => row.status === 'contacted')).toBe(true);

      const searched = await service.list({ page: 1, limit: 10, q: 'نُزل آخر' });

      expect(searched.items.map((row) => row.displayName)).toStrictEqual(['نُزل آخر']);
      /* And the count agrees with the list — one `FROM … WHERE` behind both. */
      expect(searched.total).toBe(1);
    });

    /**
     * THE regression this table exists for (Bashar, 2026-08-20).
     *
     * `markContacted` used to `SET … contact_notes = $1` on `partner_applications`, so a second
     * telephone call overwrote the first one's note, its timestamp and whoever made it. «سجل
     * الطلب» could only ever show one «تم الاتصال» line however many times somebody had rung —
     * and the note that got lost was usually the one explaining why they were being rung again.
     */
    it('keeps every call, and never overwrites an earlier note', async () => {
      const request = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      await service.markContacted(
        reviewer,
        request.reference,
        'السجل التجاري عند المحاسب.',
      );
      await service.markContacted(
        reviewer,
        request.reference,
        'وصل السجل، بقي عقد الإيجار.',
      );
      await service.markContacted(reviewer, request.reference, 'اكتمل الملف.');

      const detail = await service.detail(request.reference);

      expect(detail.contacts.map((contact) => contact.notes)).toStrictEqual([
        'السجل التجاري عند المحاسب.',
        'وصل السجل، بقي عقد الإيجار.',
        'اكتمل الملف.',
      ]);
    });

    /** Oldest first, so «سجل الطلب» reads downwards: arrival, each call, the decision. */
    it('returns the calls in the order they happened', async () => {
      const request = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      await service.markContacted(reviewer, request.reference, 'الأولى');
      await service.markContacted(reviewer, request.reference, 'الثانية');

      const times = (await service.detail(request.reference)).contacts.map((c) =>
        Date.parse(c.at),
      );

      expect(times[0]).toBeLessThanOrEqual(times[1] as number);
    });

    /** Each call records who made it, so a history of four notes is not four anonymous ones. */
    it('records the caller on every call', async () => {
      const request = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      await service.markContacted(reviewer, request.reference, 'مرة');
      await service.markContacted(reviewer, request.reference, 'مرتان');

      const detail = await service.detail(request.reference);

      expect(detail.contacts).toHaveLength(2);
      expect(detail.contacts.every((contact) => contact.byEmail !== null)).toBe(true);
    });

    /**
     * The registry shows one date per row, and it must be the LATEST call rather than the first —
     * "when did we last reach them" is the question a queue answers. Derived from the call log, so
     * it cannot drift from the notes the way the column it replaces did.
     */
    it('reports the most recent call on the registry row', async () => {
      const request = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      await service.markContacted(reviewer, request.reference, 'الأولى');
      const afterFirst = await service.detail(request.reference);

      await service.markContacted(reviewer, request.reference, 'الثانية');
      const afterSecond = await service.detail(request.reference);

      expect(afterFirst.contactedAt).not.toBeNull();
      expect(Date.parse(afterSecond.contactedAt as string)).toBeGreaterThanOrEqual(
        Date.parse(afterFirst.contactedAt as string),
      );

      /* And it is the last call's time, not the first's. */
      const last = afterSecond.contacts.at(-1);

      expect(afterSecond.contactedAt).toBe(last?.at);
    });

    /** A request nobody has rung has no calls and no date — not an empty-string placeholder. */
    it('reports no contact at all before anybody rings', async () => {
      const request = await service.submit(application(), { userId: CUSTOMER_USER_ID });
      const detail = await service.detail(request.reference);

      expect(detail.contacts).toStrictEqual([]);
      expect(detail.contactedAt).toBeNull();
      expect(detail.contactedByEmail).toBeNull();
    });

    /** The badge counts what somebody still has to do — decided requests are not work. */
    it('counts only requests nobody has decided', async () => {
      const before = await service.openCount();
      const created = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      expect(await service.openCount()).toBe(before + 1);

      await service.reject(reviewer, created.reference, 'خارج نطاق التغطية');

      expect(await service.openCount()).toBe(before);
    });
  });

  describe('accepting', () => {
    /**
     * The ordinary case, and the shape of the whole flow: a partner record that is PENDING, and an
     * invitation rather than a password.
     */
    it('creates a pending partner and invites the applicant, without a password', async () => {
      const created = await service.submit(application(), { userId: CUSTOMER_USER_ID });
      const detail = await service.accept(reviewer, created.reference);

      expect(detail.status).toBe('accepted');
      expect(detail.partnerReference).toMatch(/^PAR-\d{6,}$/);
      /* Step 5: the account stays pending until somebody checks the documents. */
      expect(detail.partnerVerification).toBe('pending');

      /* The partner record hangs off the account that APPLIED — no account is created here. */
      const owner = await db.execute<{ user_id: string }>(sql`
        SELECT user_id FROM partners WHERE reference = ${detail.partnerReference}
      `);

      expect(owner.rows[0]?.user_id).toBe(CUSTOMER_USER_ID);

      const invitation = sent.at(-1);

      expect(invitation?.to).toBe(CUSTOMER_EMAIL);
      /*
        NOT withheld from the development log — see the template.

        The body is the link, and without SMTP the log is the only place a developer can read it.
        What matters for §1 is asserted on the next line instead: no password is ever in it.
      */
      expect(invitation?.sensitive).toBeUndefined();
      expect(invitation?.text).toContain('https://partner.safra.test/invitation/');
      /* Never a credential in an inbox. The one thing §1 forbids most plainly. */
      expect(invitation?.text).not.toMatch(/password:\s*\S/i);
    });

    /**
     * The denial-of-service this design exists to prevent.
     *
     * Anybody can type anybody's address into a public form. If accepting converted the account
     * behind it, applying as somebody else would take their login away from them.
     */
    it('leaves an existing customer account completely untouched', async () => {
      const created = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      await service.accept(reviewer, created.reference);

      const account = await db.execute<{
        role: string;
        password_hash: string | null;
      }>(sql`
        SELECT role::text AS role, password_hash FROM users WHERE id = ${CUSTOMER_USER_ID}::uuid
      `);

      expect(account.rows[0]?.role).toBe('customer');
      /* Their password still works. Accepting an application is not a password reset. */
      expect(account.rows[0]?.password_hash).toBe('$argon2id$existing');
      /* And the invitation was issued against THAT account, so redeeming it converts theirs. */
      expect(issued.at(-1)).toStrictEqual({
        userId: CUSTOMER_USER_ID,
        purpose: 'partner_invitation',
      });
    });

    /**
     * The two ineligible accounts are refused when the request is FILED.
     *
     * They used to be refused at acceptance, which meant a staff member could file a request, be
     * telephoned, and only then be told it could never be accepted. Both ends are checked now:
     * these assert the early refusal, and the one below asserts the re-check at acceptance.
     */
    it('refuses a staff account before a request is even written', async () => {
      await expect(
        service.submit(application(), { userId: STAFF_USER_ID }),
      ).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_APPLICATION_EMAIL_IS_STAFF },
      });

      const rows = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM partner_applications
        WHERE submitted_by_user_id = ${STAFF_USER_ID}::uuid
      `);

      expect(rows.rows[0]?.n).toBe('0');
    });

    it('refuses an account that is already a partner', async () => {
      await expect(
        service.submit(application(), { userId: EXISTING_PARTNER_USER_ID }),
      ).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_APPLICATION_EMAIL_IS_PARTNER },
      });
    });

    /**
     * And again at ACCEPTANCE, because days pass in between.
     *
     * An ordinary customer files a request on Monday and is made an operations manager on
     * Thursday; accepting on Friday must not demote them. The re-check is what makes the window
     * between the two calls safe rather than merely short.
     */
    it('refuses to accept a request whose account has become staff since', async () => {
      const created = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      await db.execute(sql`
        UPDATE users SET role = 'operations_manager'::user_role
        WHERE id = ${CUSTOMER_USER_ID}::uuid
      `);

      await expect(service.accept(reviewer, created.reference)).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_APPLICATION_EMAIL_IS_STAFF },
      });

      /* Nothing half-done: no partner, no invitation, and the request is still open. */
      expect(issued).toHaveLength(0);
      expect((await service.detail(created.reference)).status).toBe('submitted');
    });

    it('refuses to decide a request twice', async () => {
      const created = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      await service.accept(reviewer, created.reference);

      await expect(service.accept(reviewer, created.reference)).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_APPLICATION_ALREADY_DECIDED },
      });

      await expect(
        service.reject(reviewer, created.reference, 'غيّرنا رأينا'),
      ).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_APPLICATION_ALREADY_DECIDED },
      });
    });

    it('answers a reference that does not exist the same as one that is not a reference', async () => {
      await expect(service.detail('PRQ-999999')).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_APPLICATION_NOT_FOUND },
      });

      await expect(
        service.detail("'; DROP TABLE partner_applications; --"),
      ).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_APPLICATION_NOT_FOUND },
      });
    });
  });

  describe('rejecting', () => {
    it('records the reason and mails it to the applicant', async () => {
      const created = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      const detail = await service.reject(
        reviewer,
        created.reference,
        'المدينة خارج التغطية',
      );

      expect(detail.status).toBe('rejected');
      expect(detail.decisionNotes).toBe('المدينة خارج التغطية');
      expect(sent.at(-1)?.text).toContain('المدينة خارج التغطية');
    });
  });

  describe('redeeming the invitation', () => {
    /** The one moment an account becomes a partner account. */
    it('sets the first password, flips the role and revokes every session', async () => {
      const created = await service.submit(application(), { userId: CUSTOMER_USER_ID });

      await service.accept(reviewer, created.reference);
      await service.acceptInvitation(
        `token-for-${CUSTOMER_USER_ID}`,
        'a-very-strong-password-1',
      );

      const account = await db.execute<{
        role: string;
        password_hash: string | null;
      }>(sql`
        SELECT role::text AS role, password_hash FROM users WHERE id = ${CUSTOMER_USER_ID}::uuid
      `);

      expect(account.rows[0]?.role).toBe('partner');
      expect(account.rows[0]?.password_hash).toBe('$argon2id$fake');
      /* A role change that takes fifteen minutes to apply is not a role change. */
      expect(revoked).toStrictEqual([CUSTOMER_USER_ID]);
    });

    it('refuses a token that is not one of ours, with one message for every failure', async () => {
      await expect(
        service.acceptInvitation('not-a-token', 'a-very-strong-password-1'),
      ).rejects.toMatchObject({ response: { code: ERROR.PARTNER_INVITATION_INVALID } });
    });

    /**
     * A token that outlived its premise.
     *
     * The address was a customer when the application was accepted and is staff by the time the
     * link is clicked. Re-checked at redemption, so the link redeems into nothing rather than
     * demoting somebody.
     */
    it('refuses to convert an account that has become staff since it was invited', async () => {
      await expect(
        service.acceptInvitation(
          `token-for-${STAFF_USER_ID}`,
          'a-very-strong-password-1',
        ),
      ).rejects.toMatchObject({ response: { code: ERROR.PARTNER_INVITATION_INVALID } });

      const account = await db.execute<{ role: string }>(sql`
        SELECT role::text AS role FROM users WHERE id = ${STAFF_USER_ID}::uuid
      `);

      expect(account.rows[0]?.role).toBe('operations_manager');
    });

    /** No partner record means the invitation belongs to nothing. Refused, not half-applied. */
    it('refuses a redemption with no partner record behind it', async () => {
      await expect(
        service.acceptInvitation(
          `token-for-${CUSTOMER_USER_ID}`,
          'a-very-strong-password-1',
        ),
      ).rejects.toMatchObject({ response: { code: ERROR.PARTNER_INVITATION_INVALID } });
    });
  });
});

async function seed(db: Database): Promise<void> {
  await db.execute(sql`
    INSERT INTO users (id, email, role, status, password_hash, preferred_locale)
    VALUES (${STAFF_USER_ID}::uuid, ${STAFF_EMAIL}, 'operations_manager'::user_role, 'active',
            '$argon2id$staff', 'ar'),
           (${CUSTOMER_USER_ID}::uuid, ${CUSTOMER_EMAIL}, 'customer'::user_role, 'active',
            '$argon2id$existing', 'ar'),
           (${SECOND_CUSTOMER_USER_ID}::uuid, ${SECOND_CUSTOMER_EMAIL}, 'customer'::user_role,
            'active', '$argon2id$existing', 'ar'),
           (${EXISTING_PARTNER_USER_ID}::uuid, ${EXISTING_PARTNER_EMAIL}, 'partner'::user_role,
            'active', '$argon2id$partner', 'ar'),
           (${REVIEWER_ID}::uuid, 'application-test-reviewer@safra.test', 'super_admin'::user_role,
            'active', '$argon2id$reviewer', 'ar')
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO partners (id, user_id, partner_type_id, legal_name, display_name, city_id,
                          address, phone, email)
    SELECT ${EXISTING_PARTNER_ID}::uuid, ${EXISTING_PARTNER_USER_ID}::uuid, pt.id,
           'شريك قائم', 'شريك قائم', c.id, 'عنوان', '+963116414444', ${EXISTING_PARTNER_EMAIL}
    FROM partner_types pt, cities c
    WHERE pt.code = 'accommodation' AND c.slug = 'damascus'
    LIMIT 1
    ON CONFLICT DO NOTHING`);
}
