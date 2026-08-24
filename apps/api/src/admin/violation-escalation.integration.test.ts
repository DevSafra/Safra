import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { EnforcementNotifier } from './enforcement-notifier.js';
import { EnforcementService } from './enforcement.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { Env } from '../config/env.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import type { LedgerService } from '../ledger/ledger.service.js';
import type { OutgoingMail } from '../mail/mail.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * The ladder's fourth rung: a suspension that names the violation it answers.
 *
 * ## What was wrong, and why no test caught it
 *
 * `violation_stage` has run `recorded → warned → fined → suspension` since the enum was written.
 * Three of those were reachable. `suspension` was accepted by the `violation_stage` enum, listed in
 * `VIOLATION_STAGES`, parsed by the partner portal's zod schema, and given an Arabic label
 * («رُفع إلى الإيقاف») — and **no code path could produce it.** Every one of those five places read
 * as coverage for a state the platform could not enter.
 *
 * It is the same defect as a grantable capability with no route behind it (`O-staff-1`), and it
 * survived for the same reason: everything that mentions it is consistent with everything else that
 * mentions it. Only asking "what WRITES this" finds it, and nothing was asking.
 *
 * ## Why the scope test is the important one
 *
 * `violationId` arrives in a request body. The stage write is scoped by `partner_id` in its own
 * predicate rather than checked afterwards, so a staff member with `PARTNER_SUSPEND` cannot mark
 * ANOTHER partner's violation as having caused a suspension it had nothing to do with. That would
 * be a write to an append-only history the platform asks an appeal to trust, on a row the actor was
 * never authorised for.
 *
 * The second test is the one that was watched to fail: with `AND partner_id = …` removed from both
 * statements in `escalate`, it goes green on the wrong partner's row.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const staff: AccessTokenClaims = {
  sub: '',
  role: 'super_admin',
  permissions: [],
  locale: 'ar',
};

const REASON = 'إيقاف بعد ثلاث مخالفات متكررة في تحديث التقويم خلال شهر واحد';

describeIfDb('suspending a partner because of a violation', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');

  let db: Database;
  let enforcement: EnforcementService;
  let notified: {
    templateKey: string;
    channel: string;
    locale: string;
    to: string | null;
  }[];
  let run = 0;

  /** A partner of its own, so nothing here depends on what the seed happens to contain. */
  async function makePartner(tag: string): Promise<{ id: string; reference: string }> {
    const email = `esc-${process.pid}-${run}-${tag}@safra.test`;
    const made = await db.execute<{ id: string; reference: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM partner_types LIMIT 1) AS type_id
      ), u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES (${email}, '+963900000000', 'partner', 'active', 'ar')
        RETURNING id
      )
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email, verification)
      SELECT u.id, ref.type_id, 'Esc', 'تصعيد', ref.city_id, 'x', '+963900000000',
             ${email}, 'approved'
      FROM u, ref
      RETURNING id, reference
    `);

    const row = made.rows[0];

    if (!row) throw new Error('fixture partner was not created');

    return row;
  }

  async function makeViolation(partnerId: string, stage = 'fined'): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO partner_violations (partner_id, kind, occurrence_number, stage, score_penalty)
      VALUES (${partnerId}::uuid, 'stale_calendar', 1, ${stage}::violation_stage, 0)
      RETURNING id
    `);

    const row = made.rows[0];

    if (!row) throw new Error('fixture violation was not created');

    return row.id;
  }

  const stageOf = async (violationId: string): Promise<string> => {
    const row = await db.execute<{ stage: string }>(sql`
      SELECT stage::text AS stage FROM partner_violations WHERE id = ${violationId}::uuid
    `);

    return row.rows[0]?.stage ?? '';
  };

  const escalationRows = async (partnerId: string): Promise<number> => {
    const row = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM audit_log
      WHERE action = 'violation.escalated' AND subject_id = ${partnerId}::uuid
    `);

    return row.rows[0]?.n ?? 0;
  };

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    run += 1;

    /* A real staff row, so `waived_by_user_id` and `actor_user_id` have something to point at. */
    const actor = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale)
      VALUES (${`esc-staff-${process.pid}-${run}@safra.test`}, '+963900000001',
              'super_admin', 'active', 'ar')
      RETURNING id
    `);

    staff.sub = actor.rows[0]?.id ?? '';

    /*
      A REAL notifier over a stubbed queue, not a stubbed notifier.

      The notifier is what decides the recipient, the locale and the two channels — the three things
      `O-partner-11` was about — so stubbing it would leave the part most worth testing untested.
      What is stubbed is one level lower: `NotificationService`, so nothing reaches Redis or SMTP and
      the calls can be counted.
    */
    notified = [];
    enforcement = new EnforcementService(
      db,
      new AuditService(db),
      /* Waiving is not exercised here, so the ledger and fx are never called. */
      {} as unknown as LedgerService,
      {} as unknown as FxRateService,
      new EnforcementNotifier(
        db,
        { PARTNER_URL: 'https://partner.safra.test' } as unknown as Env,
        {
          notify: (templateKey: string, mail: OutgoingMail, locale: string) =>
            Promise.resolve(
              void notified.push({ templateKey, channel: 'email', locale, to: mail.to }),
            ),
          recordInApp: (templateKey: string, locale: string) =>
            Promise.resolve(
              void notified.push({ templateKey, channel: 'in_app', locale, to: null }),
            ),
        } as unknown as NotificationService,
        new AuditService(db),
      ),
    );
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /**
   * Raising a violation STORES the description, and fining it stores the fine's reason.
   *
   * ## The defect this is written against
   *
   * Both reasons were required by their schemas — twenty-character floor, labelled «يقرأه الشريك»
   * on the console — and both were written to `audit_log.reason` and nowhere else. There was no
   * column for either. `audit_log.subject_id` is the PARTNER rather than the violation, so the
   * words could not even be joined back to the row they described: the platform accused a business
   * of something, told the operator the partner would read it, and had no way to show them.
   *
   * Asserted against the COLUMNS rather than through the partner's list, because this is the half
   * that was missing. The list reading them is asserted separately in
   * `arrivals.integration.test.ts`; a test that only read the list would pass against a service
   * that stored the words in the wrong row.
   */
  it('stores the description on raise and the reason on fine', async () => {
    const partner = await makePartner('prose');
    const description =
      'تقويم الوحدة ١٠١ لم يُحدَّث منذ أحد عشر يوماً وبقيت التواريخ مفتوحة.';
    const fineReason = 'مخالفة متكررة بعد إشعارين سابقين خلال الشهر نفسه.';

    const made = await enforcement.raise(staff, partner.reference, {
      kind: 'stale_calendar',
      reason: description,
    });

    const stored = await db.execute<{ description: string | null }>(sql`
      SELECT description FROM partner_violations WHERE id = ${made.id}::uuid
    `);

    expect(stored.rows[0]?.description).toBe(description);

    await enforcement.fine(staff, made.id, {
      amount: '50.00',
      currencyCode: 'USD',
      reason: fineReason,
    });

    const fined = await db.execute<{ fine_reason: string | null }>(sql`
      SELECT fine_reason FROM partner_violations WHERE id = ${made.id}::uuid
    `);

    expect(fined.rows[0]?.fine_reason).toBe(fineReason);
  });

  /**
   * The CONSOLE's own list carries the words too, and this is a mapping test on purpose.
   *
   * `list()` builds its response from a hand-written field list beside the query. The columns were
   * added to the SELECT and left out of that mapping on the first attempt, so the console's schema —
   * which requires both — rejected the whole response and مخالفات said «تعذّر تحميل هذه القائمة»
   * while the API answered 200. The browser pass caught it in minutes; nothing else would have,
   * because a query test would have seen the columns and a schema test would have seen the schema.
   *
   * Asserted through `list()` rather than against the SQL for exactly that reason: the defect lived
   * between them.
   */
  it('returns the description and the fine reason to the console', async () => {
    const partner = await makePartner('console');

    await enforcement.raise(staff, partner.reference, {
      kind: 'stale_calendar',
      reason: 'وصف المخالفة كما كتبه الموظف ليقرأه الشريك.',
    });

    const page = await enforcement.list(partner.reference, { limit: 25, page: 1 });
    const row = page.items[0] as Record<string, unknown> | undefined;

    expect(row?.['description']).toBe('وصف المخالفة كما كتبه الموظف ليقرأه الشريك.');
    expect(row).toHaveProperty('fineReason');
  });

  it('takes the cited violation to the suspension stage', async () => {
    const partner = await makePartner('a');
    const violationId = await makeViolation(partner.id);

    await enforcement.suspend(staff, partner.reference, { reason: REASON, violationId });

    expect(await stageOf(violationId)).toBe('suspension');
    expect(await escalationRows(partner.id)).toBe(1);
  });

  /**
   * The security assertion, and the one with an opposite control below it.
   *
   * A violation belonging to somebody else must be unreachable rather than merely unmodified —
   * "not yours" answering the same as "not there". The refusal is `VIOLATION_NOT_FOUND`, which is
   * also what a made-up uuid gets, so the response cannot be used to discover whether a violation
   * exists on a partner the actor is not acting on.
   */
  it('refuses a violation that belongs to another partner, and changes nothing', async () => {
    const target = await makePartner('target');
    const bystander = await makePartner('bystander');
    const theirViolation = await makeViolation(bystander.id);

    await expect(
      enforcement.suspend(staff, target.reference, {
        reason: REASON,
        violationId: theirViolation,
      }),
      /* Nest wraps it: the code lives on `response`, which is the body the client receives. */
    ).rejects.toMatchObject({ response: { code: 'violation.not_found' } });

    /* The bystander's row is untouched… */
    expect(await stageOf(theirViolation)).toBe('fined');
    expect(await escalationRows(bystander.id)).toBe(0);

    /* …and the whole suspension rolled back with it, rather than half-applying. */
    const suspended = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM partners
      WHERE id = ${target.id}::uuid AND suspended_at IS NOT NULL
    `);

    expect(suspended.rows[0]?.n).toBe(0);
  });

  /**
   * The opposite control the rule above demands.
   *
   * Without this, deleting the `violationId` handling entirely would satisfy the refusal test
   * perfectly — nothing would ever escalate, so nothing could escalate wrongly. This is what
   * distinguishes "withheld from the wrong partner" from "not implemented".
   */
  it('accepts the SAME violation when it is the suspended partner’s own', async () => {
    const partner = await makePartner('own');
    const violationId = await makeViolation(partner.id);

    await enforcement.suspend(staff, partner.reference, { reason: REASON, violationId });

    expect(await stageOf(violationId)).toBe('suspension');
  });

  /** Suspending with no violation cited leaves the ladder alone — the linkage is opt-in. */
  it('does not touch any violation when none is cited', async () => {
    const partner = await makePartner('plain');
    const violationId = await makeViolation(partner.id);

    await enforcement.suspend(staff, partner.reference, { reason: REASON });

    expect(await stageOf(violationId)).toBe('fined');
    expect(await escalationRows(partner.id)).toBe(0);
  });

  /**
   * Re-citing a violation already at `suspension` is idempotent, not an error.
   *
   * `stage` is forward-only and `suspension` is terminal, so this is reachable in the ordinary way:
   * escalate, lift the suspension, then cite the same violation again. Refusing would block a
   * legitimate suspension over a linkage that is already recorded — and writing a second audit row
   * would claim a transition that did not happen.
   */
  it('re-citing an already escalated violation suspends without a second audit row', async () => {
    const partner = await makePartner('again');
    const violationId = await makeViolation(partner.id, 'suspension');

    await enforcement.suspend(staff, partner.reference, { reason: REASON, violationId });

    expect(await stageOf(violationId)).toBe('suspension');
    expect(await escalationRows(partner.id)).toBe(0);

    const suspended = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM partners
      WHERE id = ${partner.id}::uuid AND suspended_at IS NOT NULL
    `);

    expect(suspended.rows[0]?.n).toBe(1);
  });

  /**
   * The partner still hears about it, on BOTH channels, at the account address.
   *
   * Three things at once, and each was a defect before 2026-08-24: that a suspension notifies at
   * all when a violation is cited (the extra work must not cost the notice), that it goes out
   * in-app as well as by email, and that it is addressed to `users.email` rather than
   * `partners.email` — `O-partner-11`, where the two diverged for the main fixture and a suspended
   * business would have been told nothing.
   */
  it('notifies the partner on both channels, at the account address', async () => {
    const partner = await makePartner('mail');
    const violationId = await makeViolation(partner.id);

    await enforcement.suspend(staff, partner.reference, { reason: REASON, violationId });

    expect(notified.map((n) => n.channel).sort()).toStrictEqual(['email', 'in_app']);
    expect(notified.every((n) => n.templateKey === 'partner.suspended')).toBe(true);

    const account = await db.execute<{ email: string }>(sql`
      SELECT u.email FROM partners p JOIN users u ON u.id = p.user_id
      WHERE p.id = ${partner.id}::uuid
    `);

    expect(notified.find((n) => n.channel === 'email')?.to).toBe(account.rows[0]?.email);
  });
});
