import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR, type PartnerOnboardInput } from '@safra/contracts';

import type { AuditService } from '../common/audit/audit.service.js';
import type { AuthTokenService } from '../auth/auth-token.service.js';
import type { Env } from '../config/env.js';
import type { MailService, OutgoingMail } from '../mail/mail.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { PartnerInvitationService } from './partner-invitation.service.js';
import { PartnerOnboardingService } from './partner-onboarding.service.js';

/**
 * تسجيل شريك جديد — onboarding in person, against a real PostgreSQL.
 *
 * Everything worth asserting here is about WHO ends up holding what, and every one of those rules
 * is a row or a constraint: a partial unique index, an `EXISTS` over `partners`, a role read from
 * `users`, a null `password_hash`. None of it can be exercised against a mocked database.
 *
 * The tests are grouped by the claim they defend rather than by method, because the claim is what
 * a reader needs to be able to check: this action creates a partner and CANNOT create a way in.
 *
 * Skipped when `DATABASE_URL` is unset so local `pnpm test` stays fast.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const SUPER_ADMIN_ID = '99990000-0000-0000-0000-0000000000b1';
const OPS_MANAGER_ID = '99990000-0000-0000-0000-0000000000b2';
const CUSTOMER_ID = '99990000-0000-0000-0000-0000000000b3';
const EXISTING_PARTNER_USER_ID = '99990000-0000-0000-0000-0000000000b4';
const EXISTING_PARTNER_ID = '99990000-0000-0000-0000-0000000000b5';
const APPLICANT_ID = '99990000-0000-0000-0000-0000000000b6';

const OPS_EMAIL = 'onboarding-test-ops@safra.test';
const CUSTOMER_EMAIL = 'onboarding-test-customer@safra.test';
const EXISTING_PARTNER_EMAIL = 'onboarding-test-partner@safra.test';
const APPLICANT_EMAIL = 'onboarding-test-applicant@safra.test';
const STRANGER_EMAIL = 'onboarding-test-stranger@safra.test';

const superAdmin: AccessTokenClaims = {
  sub: SUPER_ADMIN_ID,
  role: 'super_admin',
  permissions: ['partner.onboard'],
  locale: 'ar',
};

/** A complete, valid registration. `email` is the field that makes this flow what it is. */
const onboarding = (
  overrides: Partial<PartnerOnboardInput> = {},
): PartnerOnboardInput => ({
  contactName: 'أبو محمد',
  email: STRANGER_EMAIL,
  phone: '+963116414444',
  legalName: 'شركة التسجيل المباشر',
  displayName: 'فندق التسجيل',
  partnerTypeCode: 'accommodation',
  citySlug: 'damascus',
  address: 'شارع الاختبار 1',
  notes: 'وقّعنا العقد في المكتب بحضور الطرفين.',
  preferredLocale: 'ar',
  ...overrides,
});

describeIfDb('PartnerOnboardingService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: PartnerOnboardingService;
  let sent: OutgoingMail[];
  let issued: { userId: string; purpose: string; ttlMs: number }[];
  let audited: { action: string; reason?: string | null; after?: unknown }[];

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    sent = [];
    issued = [];
    audited = [];

    const audit = {
      record: (entry: { action: string; reason?: string | null; after?: unknown }) => {
        audited.push(entry);

        return Promise.resolve();
      },
    } as unknown as AuditService;

    const mail = {
      send: (message: OutgoingMail) => {
        sent.push(message);

        return Promise.resolve();
      },
    } as unknown as MailService;

    /* Records WHICH account a link was issued against — the assertion most of these tests make. */
    const authTokens = {
      issue: (userId: string, purpose: string, ttlMs: number) => {
        issued.push({ userId, purpose, ttlMs });

        return Promise.resolve({ token: `token-for-${userId}` });
      },
    } as unknown as AuthTokenService;

    const env = {
      APP_URL: 'https://safra.test',
      PARTNER_URL: 'https://partner.safra.test',
    } as unknown as Env;

    service = new PartnerOnboardingService(
      db,
      audit,
      new PartnerInvitationService(authTokens, mail, env),
    );

    await seed(db);
  });

  afterEach(async () => {
    await harness.rollback();
    vi.restoreAllMocks();
  });

  describe('creating the partner', () => {
    it('writes the partner and answers with its reference', async () => {
      const result = await service.onboard(superAdmin, onboarding());

      expect(result.reference).toMatch(/^PAR-\d{6,}$/);
      expect(result.accountExisted).toBe(false);

      const row = await db.execute<{
        legal_name: string;
        display_name: string;
        email: string;
        phone: string;
      }>(sql`
        SELECT legal_name, display_name, email, phone
        FROM partners WHERE reference = ${result.reference}
      `);

      expect(row.rows[0]?.legal_name).toBe('شركة التسجيل المباشر');
      expect(row.rows[0]?.display_name).toBe('فندق التسجيل');
      expect(row.rows[0]?.email).toBe(STRANGER_EMAIL);
      expect(row.rows[0]?.phone).toBe('+963116414444');
    });

    /**
     * P-002, and the reason `verification` is not a field on this call.
     *
     * A partner created by the person who will approve them must still BE approved, from the
     * screen that shows the documents, through the permission that governs it.
     */
    it('leaves the partner PENDING — registering is not approving', async () => {
      const result = await service.onboard(superAdmin, onboarding());

      const row = await db.execute<{
        verification: string;
        verified_at: string | null;
      }>(sql`
        SELECT verification::text AS verification, verified_at::text AS verified_at
        FROM partners WHERE reference = ${result.reference}
      `);

      expect(row.rows[0]?.verification).toBe('pending');
      expect(row.rows[0]?.verified_at).toBeNull();
    });

    /** Nobody filed a request, so «طلبات الشراكة» must not grow one (Bashar, 2026-08-23). */
    it('writes no application row', async () => {
      await service.onboard(superAdmin, onboarding());

      const rows = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count FROM partner_applications
        WHERE lower(email) = lower(${STRANGER_EMAIL})
      `);

      expect(rows.rows[0]?.count).toBe('0');
    });

    it('records its own audit action, carrying the operator note', async () => {
      await service.onboard(superAdmin, onboarding());

      const entry = audited.find((e) => e.action === 'partner.onboarded_in_person');

      expect(entry).toBeDefined();
      expect(entry?.reason).toBe('وقّعنا العقد في المكتب بحضور الطرفين.');

      /* Never `partner_application.accepted` — that action means a request was granted. */
      expect(audited.some((e) => e.action === 'partner_application.accepted')).toBe(
        false,
      );
    });

    it('records a timeline event naming the super admin who did it', async () => {
      const result = await service.onboard(superAdmin, onboarding());

      const rows = await db.execute<{
        event_type: string;
        actor_user_id: string | null;
      }>(sql`
        SELECT t.event_type, t.actor_user_id::text AS actor_user_id
        FROM timeline_events t
        JOIN partners p ON p.id = t.subject_id
        WHERE p.reference = ${result.reference} AND t.subject_type = 'partner'
      `);

      expect(rows.rows[0]?.event_type).toBe('partner.onboarded_in_person');
      expect(rows.rows[0]?.actor_user_id).toBe(SUPER_ADMIN_ID);
    });
  });

  /*
    The security argument for the whole feature, as tests.

    A super admin naming an address must be able to create a PARTNER RECORD and must not be able
    to create a way into that person's account. Each mechanism is asserted directly rather than
    inferred from the absence of a symptom.
  */
  describe('the account it touches', () => {
    it('creates the account with NO password — nobody can sign in as the new partner', async () => {
      await service.onboard(superAdmin, onboarding());

      const rows = await db.execute<{ password_hash: string | null; role: string }>(sql`
        SELECT password_hash, role::text AS role FROM users WHERE email = ${STRANGER_EMAIL}
      `);

      expect(rows.rows[0]?.password_hash).toBeNull();
      /* `customer`, not `partner`. Redemption flips the role; this must not pre-empt it. */
      expect(rows.rows[0]?.role).toBe('customer');
    });

    it('leaves the new account UNVERIFIED — the address is a claim until somebody answers it', async () => {
      await service.onboard(superAdmin, onboarding());

      const rows = await db.execute<{ email_verified_at: string | null }>(sql`
        SELECT email_verified_at::text AS email_verified_at
        FROM users WHERE email = ${STRANGER_EMAIL}
      `);

      expect(rows.rows[0]?.email_verified_at).toBeNull();
    });

    /**
     * The one that matters most.
     *
     * Naming an existing customer's address attaches a partner record to their account — and must
     * change NOTHING they sign in with. Their role stays `customer`, so `token.service.ts` never
     * puts a `partnerId` in their token and their permissions never grow.
     */
    it('adopts an existing customer account without altering their role or password', async () => {
      const before = await db.execute<{ password_hash: string | null }>(sql`
        SELECT password_hash FROM users WHERE id = ${CUSTOMER_ID}::uuid
      `);

      const result = await service.onboard(
        superAdmin,
        onboarding({ email: CUSTOMER_EMAIL }),
      );

      expect(result.accountExisted).toBe(true);

      const after = await db.execute<{ role: string; password_hash: string | null }>(sql`
        SELECT role::text AS role, password_hash FROM users WHERE id = ${CUSTOMER_ID}::uuid
      `);

      expect(after.rows[0]?.role).toBe('customer');
      expect(after.rows[0]?.password_hash).toBe(before.rows[0]?.password_hash);

      /* And the partner really is bound to THAT account, not to a duplicate. */
      const partner = await db.execute<{ user_id: string }>(sql`
        SELECT user_id::text AS user_id FROM partners WHERE reference = ${result.reference}
      `);

      expect(partner.rows[0]?.user_id).toBe(CUSTOMER_ID);
    });

    it('does not create a second account for an address that already has one', async () => {
      await service.onboard(superAdmin, onboarding({ email: CUSTOMER_EMAIL }));

      const rows = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count FROM users
        WHERE lower(email) = lower(${CUSTOMER_EMAIL}) AND deleted_at IS NULL
      `);

      expect(rows.rows[0]?.count).toBe('1');
    });

    /** `Ali@x` and `ali@x` are one mailbox; the schema lower-cases before it ever gets here. */
    it('matches an existing account case-insensitively', async () => {
      const result = await service.onboard(
        superAdmin,
        onboarding({ email: CUSTOMER_EMAIL.toUpperCase() }),
      );

      const partner = await db.execute<{ user_id: string }>(sql`
        SELECT user_id::text AS user_id FROM partners WHERE reference = ${result.reference}
      `);

      expect(partner.rows[0]?.user_id).toBe(CUSTOMER_ID);
    });
  });

  describe('the accounts it refuses', () => {
    /** Onboarding must not be a way to demote a colleague by mistyping their address. */
    it('refuses a staff address, and leaves that account untouched', async () => {
      await expect(
        service.onboard(superAdmin, onboarding({ email: OPS_EMAIL })),
      ).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_ONBOARDING_EMAIL_IS_STAFF },
      });

      const rows = await db.execute<{ role: string }>(sql`
        SELECT role::text AS role FROM users WHERE id = ${OPS_MANAGER_ID}::uuid
      `);

      expect(rows.rows[0]?.role).toBe('operations_manager');
    });

    it('refuses an address that is already a partner', async () => {
      await expect(
        service.onboard(superAdmin, onboarding({ email: EXISTING_PARTNER_EMAIL })),
      ).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_ONBOARDING_EMAIL_IS_PARTNER },
      });
    });

    /**
     * An open request is answered, not bypassed.
     *
     * Otherwise the queue keeps a request nobody will ever close, and the reviewer working it
     * telephones somebody who was onboarded last week.
     */
    it('refuses an address with an open partnership request', async () => {
      await expect(
        service.onboard(superAdmin, onboarding({ email: APPLICANT_EMAIL })),
      ).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_ONBOARDING_APPLICATION_OPEN },
      });
    });

    it('writes nothing and sends nothing when it refuses', async () => {
      await expect(
        service.onboard(superAdmin, onboarding({ email: OPS_EMAIL })),
      ).rejects.toThrow();

      const rows = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count FROM partners WHERE email = ${OPS_EMAIL}
      `);

      expect(rows.rows[0]?.count).toBe('0');
      expect(sent).toHaveLength(0);
    });

    it('refuses an unknown partner type and an unknown city', async () => {
      await expect(
        service.onboard(superAdmin, onboarding({ partnerTypeCode: 'not-a-type' })),
      ).rejects.toMatchObject({ response: { code: ERROR.PARTNER_TYPE_UNKNOWN } });

      await expect(
        service.onboard(superAdmin, onboarding({ citySlug: 'not-a-city' })),
      ).rejects.toMatchObject({ response: { code: ERROR.GEO_CITY_UNKNOWN } });
    });
  });

  describe('the invitation', () => {
    it('issues a partner invitation against the account the partner was bound to', async () => {
      const result = await service.onboard(superAdmin, onboarding());

      const user = await db.execute<{ id: string }>(sql`
        SELECT id::text AS id FROM users WHERE email = ${STRANGER_EMAIL}
      `);

      expect(issued).toHaveLength(1);
      expect(issued[0]?.userId).toBe(user.rows[0]?.id);
      expect(issued[0]?.purpose).toBe('partner_invitation');
      /* The same 72 hours «انضم كشريك» issues. One constant, one lifetime. */
      expect(issued[0]?.ttlMs).toBe(72 * 60 * 60 * 1000);

      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe(STRANGER_EMAIL);
      expect(sent[0]?.text).toContain('https://partner.safra.test/invitation/');
      expect(sent[0]?.text).toContain(result.reference);
    });

    /**
     * A partner is standing at the desk. A mail server being down must not make their
     * registration fail — the record is correct and the link is re-sendable.
     */
    it('still registers the partner when the invitation cannot be sent', async () => {
      const exploding = {
        issue: () => Promise.reject(new Error('SMTP is down')),
      } as unknown as AuthTokenService;

      const isolated = new PartnerOnboardingService(
        db,
        { record: () => Promise.resolve() } as unknown as AuditService,
        new PartnerInvitationService(
          exploding,
          { send: () => Promise.resolve() } as unknown as MailService,
          { PARTNER_URL: 'https://partner.safra.test' } as unknown as Env,
        ),
      );

      const result = await isolated.onboard(superAdmin, onboarding());

      const rows = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count FROM partners WHERE reference = ${result.reference}
      `);

      expect(rows.rows[0]?.count).toBe('1');
    });

    it('records the language SAFRA is to write to them in', async () => {
      await service.onboard(superAdmin, onboarding({ preferredLocale: 'de' }));

      const account = await db.execute<{ locale: string }>(sql`
        SELECT preferred_locale AS locale FROM users WHERE email = ${STRANGER_EMAIL}
      `);

      expect(account.rows[0]?.locale).toBe('de');
      expect(sent[0]?.to).toBe(STRANGER_EMAIL);
    });
  });
});

async function seed(db: Database): Promise<void> {
  await db.execute(sql`
    INSERT INTO users (id, email, role, status, password_hash, preferred_locale)
    VALUES (${SUPER_ADMIN_ID}::uuid, 'onboarding-test-super@safra.test',
            'super_admin'::user_role, 'active', '$argon2id$super', 'ar'),
           (${OPS_MANAGER_ID}::uuid, ${OPS_EMAIL}, 'operations_manager'::user_role, 'active',
            '$argon2id$staff', 'ar'),
           (${CUSTOMER_ID}::uuid, ${CUSTOMER_EMAIL}, 'customer'::user_role, 'active',
            '$argon2id$existing', 'ar'),
           (${EXISTING_PARTNER_USER_ID}::uuid, ${EXISTING_PARTNER_EMAIL}, 'partner'::user_role,
            'active', '$argon2id$partner', 'ar'),
           (${APPLICANT_ID}::uuid, ${APPLICANT_EMAIL}, 'customer'::user_role, 'active',
            '$argon2id$applicant', 'ar')
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

  /* An open request, so the "answer it, do not bypass it" refusal has something to find. */
  await db.execute(sql`
    INSERT INTO partner_applications
      (submitted_by_user_id, contact_name, email, phone, legal_name, display_name,
       partner_type_id, city_id, address)
    SELECT ${APPLICANT_ID}::uuid, 'مقدم الطلب', ${APPLICANT_EMAIL}, '+963116414444',
           'شركة الطلب', 'شركة الطلب', pt.id, c.id, 'عنوان'
    FROM partner_types pt, cities c
    WHERE pt.code = 'accommodation' AND c.slug = 'damascus'
    LIMIT 1
    ON CONFLICT DO NOTHING`);
}
