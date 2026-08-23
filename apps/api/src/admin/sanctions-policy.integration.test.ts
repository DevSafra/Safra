import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import {
  DEFAULT_SANCTIONS_POLICY,
  ERROR,
  SANCTIONS_POLICY_SETTING,
  type SanctionsPolicy,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import type { MailService } from '../mail/mail.service.js';
import type { Env } from '../config/env.js';
import { ReviewService } from './review.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * `compliance.sanctions_screening` — whether screening blocks an approval (Bashar, 2026-08-21).
 *
 * ## What is actually at risk here
 *
 * This setting can switch a compliance control off. Two things therefore have to be true of it,
 * and only one of them is about the switch working:
 *
 *  1. It does what it says — and, more importantly, does NOT do what it does not say. `advisory`
 *     must not become "screening never runs", and `off` must not leak into a stricter environment.
 *  2. **An approval made without a screening stays identifiable as such afterwards.** This is the
 *     one that matters in two years, when somebody asks whether a partner was screened and the
 *     honest answer needs to distinguish "no, by decision" from "no, and nobody noticed". A
 *     `sanctions_screened_at` of NULL cannot tell those apart; the stamped policy can.
 *
 * The second is why `sanctions_policy_at_approval` exists at all, and it gets the most tests.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the sanctions screening policy', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let review: ReviewService;
  let settings: SettingsService;
  let partnerReference = '';

  /** Every mail the approval path sends, captured rather than delivered. */
  let sent: { to: string; subject: string }[] = [];

  let staffUserId = '';

  /*
    A REAL staff row, not an invented uuid.

    `partners.verified_by_user_id` and `audit_log.actor_user_id` are both foreign keys, so a claims
    object with a made-up `sub` fails the approval on an integrity error rather than on anything
    this suite is about — which is how six of these first went red, reporting "Failed query" with
    no message at all.
  */
  const staff = (): AccessTokenClaims =>
    ({
      sub: staffUserId,
      role: 'super_admin',
      scope: { kind: 'all' },
    }) as unknown as AccessTokenClaims;

  /** Sets the policy the way the console does — through the row, not through a stub. */
  async function setPolicy(policy: SanctionsPolicy | 'nonsense'): Promise<void> {
    await db.execute(sql`
      UPDATE settings SET value = ${JSON.stringify(policy)}::jsonb
      WHERE key = ${SANCTIONS_POLICY_SETTING}
    `);

    /* The service caches for a minute, and a test must not wait for it. */
    settings.invalidate(SANCTIONS_POLICY_SETTING);
  }

  beforeEach(async () => {
    await harness.begin();

    sent = [];
    settings = new SettingsService(db);
    review = new ReviewService(
      db,
      new AuditService(db),
      {} as never,
      settings,
      {
        send: (mail: { to: string; subject: string }) => {
          sent.push({ to: mail.to, subject: mail.subject });

          return Promise.resolve();
        },
      } as unknown as MailService,
      { PARTNER_URL: 'https://partner.example' } as Env,
    );

    /*
      The row may predate this feature on a database seeded before it existed.

      Written without `ON CONFLICT (key)`: the unique index is on `(key, scope, scope_id)` where
      not deleted, so naming `key` alone matches no arbiter and the statement fails outright —
      which is how this suite first went red, eight tests reporting an empty "Failed query".
    */
    await db.execute(sql`
      INSERT INTO settings (key, value, value_schema, description_en, description_ar)
      SELECT ${SANCTIONS_POLICY_SETTING}, '"advisory"'::jsonb, 'sanctionsPolicy', 'x', 'x'
      WHERE NOT EXISTS (
        SELECT 1 FROM settings WHERE key = ${SANCTIONS_POLICY_SETTING} AND deleted_at IS NULL
      )
    `);

    const actor = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES ('policy-staff-' || gen_random_uuid() || '@safra.test', '+963900000211',
              'super_admin', 'active')
      RETURNING id
    `);

    staffUserId = actor.rows[0]?.id ?? '';

    const made = await db.execute<{ reference: string }>(sql`
      WITH u AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('policy-' || gen_random_uuid() || '@safra.test', '+963900000210',
                'partner', 'active')
        RETURNING id
      )
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email, verification)
      SELECT u.id, (SELECT id FROM partner_types LIMIT 1), 'Policy Test', 'سياسة',
             (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1), 'x',
             '+963900000210', 'policy-p-' || gen_random_uuid() || '@safra.test', 'pending'
      FROM u
      RETURNING reference
    `);

    partnerReference = made.rows[0]?.reference ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  const approve = () =>
    review.verifyPartner(staff(), partnerReference, { decision: 'approve' });

  const stored = async () => {
    const rows = await db.execute<{ verification: string; policy: string | null }>(sql`
      SELECT verification::text AS verification,
             sanctions_policy_at_approval AS policy
      FROM partners WHERE reference = ${partnerReference}
    `);

    return rows.rows[0];
  };

  // ── required ────────────────────────────────────────────────────────────────

  describe('required', () => {
    beforeEach(() => setPolicy('required'));

    it('refuses to approve a partner who has not been screened', async () => {
      await expect(approve()).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_SANCTIONS_SCREENING_REQUIRED },
      });
    });

    it('leaves the partner pending when it refuses', async () => {
      await approve().catch(() => null);

      expect((await stored())?.verification).toBe('pending');
    });
  });

  // ── advisory ────────────────────────────────────────────────────────────────

  describe('advisory', () => {
    beforeEach(() => setPolicy('advisory'));

    it('approves a partner who has not been screened', async () => {
      await approve();

      expect((await stored())?.verification).toBe('approved');
    });

    /**
     * THE test. Without this column the approval above is indistinguishable, afterwards, from one
     * where screening was required and silently did not happen.
     */
    it('records that the approval was made under advisory', async () => {
      await approve();

      expect((await stored())?.policy).toBe('advisory');
    });
  });

  // ── off ─────────────────────────────────────────────────────────────────────

  describe('off', () => {
    beforeEach(() => setPolicy('off'));

    it('approves, and records the policy that allowed it', async () => {
      await approve();

      const row = await stored();

      expect(row?.verification).toBe('approved');
      expect(row?.policy).toBe('off');
    });
  });

  // ── The edges that decide whether this is safe ───────────────────────────────

  /**
   * A policy read at approval time, not at boot.
   *
   * The service caches settings for a minute. If the cache outlived a change, an approval decided
   * seconds after somebody tightened the policy would be allowed AND stamped with the new value —
   * a record saying the control was in force when it was not, which is worse than no record.
   */
  it('follows a change made between two approvals', async () => {
    await setPolicy('advisory');
    await approve();
    expect((await stored())?.policy).toBe('advisory');

    await setPolicy('required');

    await db.execute(sql`
      UPDATE partners SET verification = 'pending', sanctions_policy_at_approval = NULL
      WHERE reference = ${partnerReference}
    `);

    await expect(approve()).rejects.toMatchObject({
      response: { code: ERROR.PARTNER_SANCTIONS_SCREENING_REQUIRED },
    });
  });

  /**
   * A value nobody defined falls back to the CONTRACT default, not to the strictest option.
   *
   * `settings` is hand-editable — that is the documented escape hatch for rows the form cannot
   * validate — so a typo is reachable. Falling back to `required` would present as onboarding
   * mysteriously stopping with nothing on any screen to explain it; falling back to the default
   * behaves exactly as this file's constant says it should.
   */
  it('treats an unreadable value as the default rather than guessing', async () => {
    await setPolicy('nonsense');

    if (DEFAULT_SANCTIONS_POLICY === 'required') {
      await expect(approve()).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_SANCTIONS_SCREENING_REQUIRED },
      });
    } else {
      await approve();

      expect((await stored())?.policy).toBe(DEFAULT_SANCTIONS_POLICY);
    }
  });

  /**
   * The partner is TOLD when they are approved (Bashar, 2026-08-21).
   *
   * Approval is the moment the portal opens, and nothing said so: a partner found out by signing
   * in and noticing the sidebar had grown. Sent on approval only — a rejection is a conversation,
   * and an automated "the outcome is recorded" would be worse than a phone call.
   */
  describe('telling the partner', () => {
    beforeEach(() => setPolicy('advisory'));

    it('emails the partner when they are approved', async () => {
      await approve();

      expect(sent).toHaveLength(1);
      expect(sent[0]?.subject).toContain(partnerReference);
    });

    it('says nothing on a rejection', async () => {
      await review.verifyPartner(staff(), partnerReference, {
        decision: 'reject',
        notes: 'الوثائق غير مكتملة',
      });

      expect(sent).toEqual([]);
    });

    /** And an approval that FAILS to send is still an approval. */
    it('approves even when the mail cannot be sent', async () => {
      const failing = new ReviewService(
        db,
        new AuditService(db),
        {} as never,
        settings,
        { send: () => Promise.reject(new Error('smtp down')) } as unknown as MailService,
        { PARTNER_URL: 'https://partner.example' } as Env,
      );

      await failing.verifyPartner(staff(), partnerReference, { decision: 'approve' });

      expect((await stored())?.verification).toBe('approved');
    });
  });

  /** A rejection has nothing to explain: nobody gets near any money. */
  it('stamps nothing on a rejection', async () => {
    await setPolicy('advisory');

    await review.verifyPartner(staff(), partnerReference, {
      decision: 'reject',
      notes: 'الوثائق غير مكتملة',
    });

    const row = await stored();

    expect(row?.verification).toBe('rejected');
    expect(row?.policy).toBeNull();
  });
});
