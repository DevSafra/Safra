import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { EnforcementNotifier } from './enforcement-notifier.js';
import { EnforcementService } from './enforcement.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { OutgoingMail } from '../mail/mail.service.js';
import type { Env } from '../config/env.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import type { LedgerService } from '../ledger/ledger.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Enforcement stops at the edge of a member's city scope — on every action, not on the read.
 *
 * ## The gap (`O-sec-13`, fourth instance, 2026-08-27)
 *
 * `livePartner()` resolved a partner by REFERENCE and returned no city, and not one of the six
 * actions checked a scope: `actor` was used to stamp `suspended_by_user_id` and to write the audit
 * row, and nothing else. A city-scoped operations manager could suspend, warn, fine or waive
 * against any partner in the country, and partner references are sequential so finding a target
 * was a loop rather than a guess.
 *
 * Three of the six reach a partner through `liveViolation` instead — a violation has no city of its
 * own and inherits one through `partner_id`, which `O-sec-13` names as «the easiest to miss». So
 * this file asserts BOTH resolvers.
 *
 * ## Every refusal has its opposite
 *
 * «Withheld» and «absent» are indistinguishable without a control that the right reader still
 * succeeds — a service that refused everybody would satisfy every refusal here on its own. Each
 * case therefore does the same call twice: once from outside the scope, once from inside it.
 *
 * ## And the refusal must not be identifiable
 *
 * An out-of-scope partner answers `partner.not_found` — the SAME code a partner that does not exist
 * answers. A post-fetch check would have answered `request.not_found` from `assertCanWrite`, and
 * two distinct codes behind two 404s is a way to walk the references. That is asserted, not assumed.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('enforcement outside a city scope', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');

  let db: Database;
  let enforcement: EnforcementService;
  let staffId = '';
  let run = 0;

  /** Restricted to `cities`, with no reach at all outside them. */
  const scopedTo = (...cityIds: (string | null)[]): AccessTokenClaims =>
    ({
      sub: staffId,
      role: 'operations_manager',
      permissions: [],
      locale: 'ar',
      scope: { kind: 'cities', cityIds: cityIds.filter(Boolean), outside: 'none' },
    }) as unknown as AccessTokenClaims;

  /** Restricted, but permitted to READ the rest of the country. */
  const readOnlyOutside = (...cityIds: (string | null)[]): AccessTokenClaims =>
    ({
      sub: staffId,
      role: 'operations_manager',
      permissions: [],
      locale: 'ar',
      scope: { kind: 'cities', cityIds: cityIds.filter(Boolean), outside: 'read_only' },
    }) as unknown as AccessTokenClaims;

  let home: string | null = null;
  let away: string | null = null;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    run += 1;

    const cities = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM cities WHERE deleted_at IS NULL ORDER BY id LIMIT 2`);

    home = cities.rows[0]?.id ?? null;
    away = cities.rows[1]?.id ?? null;

    /* The fixture must be able to tell two cities apart, or it measures nothing. */
    expect(home, 'a city to be scoped to').toBeTruthy();
    expect(away, 'and a different one to be scoped away from').toBeTruthy();

    const actor = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale)
      VALUES (${`scope-staff-${process.pid}-${run}@safra.test`}, '+963900000021',
              'operations_manager', 'active', 'ar')
      RETURNING id::text`);

    staffId = actor.rows[0]?.id ?? '';

    /*
      A REAL notifier over a stubbed `NotificationService`, and real ledger/fx stubs — waiving IS
      exercised here, so unlike `violation-escalation` those two cannot be empty objects.
    */
    enforcement = new EnforcementService(
      db,
      new AuditService(db),
      {
        postFineWaiver: () => Promise.resolve({ entryGroupId: crypto.randomUUID() }),
      } as unknown as LedgerService,
      { rateToSyp: () => Promise.resolve('13000.00000000') } as unknown as FxRateService,
      new EnforcementNotifier(
        db,
        { PARTNER_URL: 'https://partner.safra.test' } as unknown as Env,
        {
          notify: (_key: string, _mail: OutgoingMail, _locale: string) =>
            Promise.resolve(),
          recordInApp: () => Promise.resolve(),
        } as unknown as NotificationService,
        new AuditService(db),
      ),
    );
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /**
   * A partner in a NAMED city, so the two sides of every assertion are real.
   *
   * The address is keyed on a COUNTER rather than on the city id. It was `cityId.slice(0, 8)`, and
   * these ids are time-ordered — two cities seeded in the same millisecond share their first eight
   * characters, so the second partner of a test collided on `users_email_unique` and four cases
   * failed on the fixture rather than on anything they were measuring.
   */
  let made = 0;

  async function partnerIn(cityId: string | null): Promise<string> {
    made += 1;

    const email = `scope-p-${process.pid}-${run}-${made}@safra.test`;
    const inserted = await db.execute<{ reference: string; id: string }>(sql`
      WITH u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES (${email}, '+963900000022', 'partner', 'active', 'ar')
        RETURNING id
      )
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email, verification)
      SELECT u.id, (SELECT id FROM partner_types LIMIT 1), 'Scope', 'نطاق',
             ${cityId}::uuid, 'x', '+963900000022', ${email}, 'approved'
      FROM u
      RETURNING reference, id::text`);

    const row = inserted.rows[0];

    if (!row) throw new Error('fixture partner was not created');

    return row.reference;
  }

  async function violationOn(reference: string, stage = 'fined'): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO partner_violations (partner_id, kind, occurrence_number, stage, score_penalty,
                                      fine_amount, fine_currency_id)
      SELECT p.id, 'stale_calendar', 1, ${stage}::violation_stage, 0,
             '25.00', (SELECT id FROM currencies WHERE code = 'USD')
      FROM partners p WHERE p.reference = ${reference}
      RETURNING id::text`);

    const row = made.rows[0];

    if (!row) throw new Error('fixture violation was not created');

    return row.id;
  }

  /* ── The three actions that reach a partner directly ──────────────────────────────────────── */

  it('refuses to suspend a partner in another city, and suspends one in its own', async () => {
    const theirs = await partnerIn(away);

    await expect(
      enforcement.suspend(scopedTo(home), theirs, {
        reason: 'إيقاف شريك خارج النطاق الجغرافي المصرَّح به لهذا الموظف.',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.PARTNER_NOT_FOUND } });

    /* Nothing was written on the way to the refusal. */
    const after = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM partners
      WHERE reference = ${theirs} AND suspended_at IS NOT NULL`);

    expect(after.rows[0]?.n, 'the partner is still trading').toBe('0');

    /* The control: the same call, from the city it belongs to, works. */
    const ours = await partnerIn(home);

    await enforcement.suspend(scopedTo(home), ours, {
      reason: 'إيقاف شريك داخل النطاق الجغرافي المصرَّح به لهذا الموظف.',
    });

    const suspended = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM partners
      WHERE reference = ${ours} AND suspended_at IS NOT NULL`);

    expect(suspended.rows[0]?.n).toBe('1');
  });

  it('refuses to lift a suspension in another city, and lifts one in its own', async () => {
    const theirs = await partnerIn(away);
    const ours = await partnerIn(home);

    /* Both suspended by somebody unscoped, so the only difference is who lifts it. */
    await db.execute(sql`
      UPDATE partners SET suspended_at = now(), suspended_reason = 'x'
      WHERE reference IN (${theirs}, ${ours})`);

    await expect(
      enforcement.unsuspend(scopedTo(home), theirs, {
        reason: 'رفع الإيقاف من خارج النطاق الجغرافي المصرَّح به لهذا الموظف.',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.PARTNER_NOT_FOUND } });

    await enforcement.unsuspend(scopedTo(home), ours, {
      reason: 'رفع الإيقاف بعد معالجة السبب، من داخل النطاق الجغرافي.',
    });

    const live = await db.execute<{ reference: string }>(sql`
      SELECT reference FROM partners
      WHERE reference IN (${theirs}, ${ours}) AND suspended_at IS NULL`);

    expect(live.rows.map((row) => row.reference)).toStrictEqual([ours]);
  });

  it('refuses to raise a violation in another city, and raises one in its own', async () => {
    const theirs = await partnerIn(away);

    await expect(
      enforcement.raise(scopedTo(home), theirs, {
        kind: 'stale_calendar',
        reason: 'تسجيل مخالفة على شريك خارج النطاق الجغرافي لهذا الموظف.',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.PARTNER_NOT_FOUND } });

    const ours = await partnerIn(home);
    const raised = await enforcement.raise(scopedTo(home), ours, {
      kind: 'stale_calendar',
      reason: 'تسجيل مخالفة على شريك داخل النطاق الجغرافي لهذا الموظف.',
    });

    expect(raised.id).toBeTruthy();
  });

  /* ── The three that reach a partner THROUGH a violation ───────────────────────────────────── */

  it('refuses to warn, fine or waive on another city’s violation, and allows each on its own', async () => {
    const theirs = await violationOn(await partnerIn(away), 'recorded');
    const ours = await violationOn(await partnerIn(home), 'recorded');

    await expect(
      enforcement.warn(scopedTo(home), theirs, {
        note: 'تنبيه على مخالفة تخص شريكاً خارج النطاق الجغرافي لهذا الموظف.',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.VIOLATION_NOT_FOUND } });

    await enforcement.warn(scopedTo(home), ours, {
      note: 'تنبيه على مخالفة تخص شريكاً داخل النطاق الجغرافي لهذا الموظف.',
    });

    /* Fining: the same pair, one stage further along. */
    await expect(
      enforcement.fine(scopedTo(home), theirs, {
        amount: '25.00',
        currencyCode: 'USD',
        reason: 'غرامة على مخالفة تخص شريكاً خارج النطاق الجغرافي لهذا الموظف.',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.VIOLATION_NOT_FOUND } });

    await enforcement.fine(scopedTo(home), ours, {
      amount: '25.00',
      currencyCode: 'USD',
      reason: 'غرامة على مخالفة تخص شريكاً داخل النطاق الجغرافي لهذا الموظف.',
    });

    /* And waiving, which posts to the LEDGER. */
    await expect(
      enforcement.waive(scopedTo(home), theirs, {
        reason: 'إعفاء من غرامة تخص شريكاً خارج النطاق الجغرافي لهذا الموظف.',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.VIOLATION_NOT_FOUND } });

    await enforcement.waive(scopedTo(home), ours, {
      reason: 'إعفاء من غرامة تخص شريكاً داخل النطاق الجغرافي لهذا الموظف.',
    });

    const stages = await db.execute<{
      id: string;
      stage: string;
      waived: string | null;
    }>(sql`
      SELECT id::text, stage::text AS stage, waived_at::text AS waived
      FROM partner_violations WHERE id IN (${theirs}::uuid, ${ours}::uuid)`);

    const byId = new Map(stages.rows.map((row) => [row.id, row]));

    expect(byId.get(theirs)?.stage, 'the other city’s violation never moved').toBe(
      'recorded',
    );
    expect(byId.get(theirs)?.waived).toBeNull();
    expect(byId.get(ours)?.waived, 'and its own was waived').not.toBeNull();
  });

  /* ── The reading side ─────────────────────────────────────────────────────────────────────── */

  it('reads another city’s violations only in read_only mode', async () => {
    const theirs = await partnerIn(away);

    await violationOn(theirs, 'recorded');

    await expect(
      enforcement.list(theirs, { limit: 25, page: 1 }, scopedTo(home)),
    ).rejects.toMatchObject({ response: { code: ERROR.PARTNER_NOT_FOUND } });

    /*
      The control, and the one that proves the guard is a SCOPE and not a blanket refusal:
      `read_only` means «you may look at the rest of the country», so the same call succeeds.
    */
    const page = await enforcement.list(
      theirs,
      { limit: 25, page: 1 },
      readOnlyOutside(home),
    );

    expect(page.items).toHaveLength(1);
  });

  /**
   * `read_only` may look and may NOT act.
   *
   * The mode's whole point, and the half a single refusal test would miss: if the write guard were
   * `assertCanRead` instead of `assertCanWrite`, this member would be able to suspend a partner
   * they are only permitted to read.
   */
  it('refuses a read_only member the actions it can see', async () => {
    const theirs = await partnerIn(away);

    await expect(
      enforcement.suspend(readOnlyOutside(home), theirs, {
        reason: 'محاولة إيقاف من موظف صلاحيته خارج نطاقه هي القراءة فقط.',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.SCOPE_OUTSIDE } });
  });

  /**
   * An out-of-scope partner is indistinguishable from one that does not exist.
   *
   * Same status AND same code. `assertCanWrite` answers `request.not_found`, which is a different
   * code behind the same 404 — and a difference a caller can read is a difference a caller can walk
   * the references with. That is why the predicate is in the lookup rather than a check after it.
   */
  it('answers a partner in another city exactly as one that does not exist', async () => {
    const theirs = await partnerIn(away);

    const outOfScope = await enforcement
      .suspend(scopedTo(home), theirs, {
        reason: 'محاولة إيقاف لقياس شكل الرفض، لا أكثر من ذلك إطلاقاً.',
      })
      .catch((error: unknown) => error);
    const absent = await enforcement
      .suspend(scopedTo(home), 'PRT-000000', {
        reason: 'محاولة إيقاف لقياس شكل الرفض، لا أكثر من ذلك إطلاقاً.',
      })
      .catch((error: unknown) => error);

    const shape = (error: unknown): unknown => ({
      status: (error as { status?: number }).status,
      code: (error as { response?: { code?: string } }).response?.code,
    });

    expect(shape(outOfScope)).toStrictEqual(shape(absent));
  });
});
