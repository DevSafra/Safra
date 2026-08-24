import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { EnforcementNotifier } from './enforcement-notifier.js';
import { EnforcementService } from './enforcement.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { Env } from '../config/env.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { OutgoingMail } from '../mail/mail.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Every enforcement action tells the partner, on both channels, at the right address.
 *
 * > Bashar, 2026-08-24: *"The partner must be notified whenever an administrative or financial
 * > enforcement action changes their status, obligations, or access."*
 *
 * ## What this is written against
 *
 * Before that date, two of the five events notified anybody — suspension and the fine waiver — and
 * the console said «وأُبلغ الشريك» for a warning, a fine and a lifted suspension as well. A warning
 * nobody receives is not a warning; it is a record the platform can later cite against a partner
 * who was never told, and `warned` exists as its own rung precisely because somebody TOLD them.
 *
 * ## Why the recipient is asserted with the two addresses deliberately different
 *
 * `O-partner-11`. Enforcement mail went to `partners.email` — the address on the APPLICATION — and
 * for the main fixture that diverged from the sign-in account when the partner was handed a new
 * address. A test with both columns equal passes against either implementation and proves nothing,
 * so the fixture sets them apart on purpose and the assertion names the account.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type Sent = {
  templateKey: string;
  channel: 'email' | 'in_app';
  locale: string;
  to: string | null;
};

const REASON = 'مخالفة متكررة في تحديث التقويم بعد إشعارين سابقين خلال شهر واحد';

describeIfDb('what an enforcement action tells the partner', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');

  let db: Database;
  let enforcement: EnforcementService;
  let sent: Sent[];
  let staff: AccessTokenClaims;
  let partnerId = '';
  let reference = '';
  let accountEmail = '';
  let run = 0;

  /** A notifier whose transport is captured, and optionally made to fail. */
  function build(options: { failing?: boolean } = {}): EnforcementService {
    const transport = {
      notify: (templateKey: string, mail: OutgoingMail, locale: string) => {
        if (options.failing) return Promise.reject(new Error('SMTP refused the message'));

        sent.push({ templateKey, channel: 'email', locale, to: mail.to });

        return Promise.resolve();
      },
      recordInApp: (templateKey: string, locale: string) => {
        if (options.failing) return Promise.reject(new Error('the database went away'));

        sent.push({ templateKey, channel: 'in_app', locale, to: null });

        return Promise.resolve();
      },
    } as unknown as NotificationService;

    return new EnforcementService(
      db,
      new AuditService(db),
      new LedgerService(db),
      new FxRateService(db, new AuditService(db)),
      new EnforcementNotifier(
        db,
        { PARTNER_URL: 'https://partner.safra.test' } as unknown as Env,
        transport,
        new AuditService(db),
      ),
    );
  }

  const violation = async (fined = false): Promise<string> => {
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO partner_violations (partner_id, kind, occurrence_number, stage, description,
                                      score_penalty
                                      ${fined ? sql`, fine_amount, fine_currency_id` : sql``})
      VALUES (${partnerId}::uuid, 'stale_calendar', 1,
              ${fined ? 'fined' : 'recorded'}::violation_stage, ${REASON}, 0
              ${fined ? sql`, '50.00', (SELECT id FROM currencies WHERE code = 'USD')` : sql``})
      RETURNING id
    `);

    return made.rows[0]?.id ?? '';
  };

  const notices = async (): Promise<{ action: string; payload: string }[]> => {
    const rows = await db.execute<{ action: string; payload: string }>(sql`
      SELECT action, coalesce(after, '{}'::jsonb)::text AS payload
      FROM audit_log
      WHERE subject_id = ${partnerId}::uuid AND action = 'partner.notified'
      ORDER BY created_at
    `);

    return rows.rows;
  };

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    run += 1;
    sent = [];

    accountEmail = `notif-account-${process.pid}-${run}@safra.test`;

    const made = await db.execute<{ id: string; reference: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM partner_types LIMIT 1) AS type_id
      ), u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES (${accountEmail}, '+963900000000', 'partner', 'active', 'de')
        RETURNING id
      )
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email, verification)
      -- partners.email is DELIBERATELY not the account address -- see the file note. The notice
      -- must go to the account, and a fixture with both the same could not tell the two apart.
      SELECT u.id, ref.type_id, 'Notif', 'إشعار', ref.city_id, 'x', '+963900000000',
             ${`notif-application-${process.pid}-${run}@safra.test`}, 'approved'
      FROM u, ref
      RETURNING id, reference
    `);

    partnerId = made.rows[0]?.id ?? '';
    reference = made.rows[0]?.reference ?? '';

    const actor = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale)
      VALUES (${`notif-staff-${process.pid}-${run}@safra.test`}, '+963900000001',
              'super_admin', 'active', 'ar')
      RETURNING id
    `);

    staff = {
      sub: actor.rows[0]?.id,
      role: 'super_admin',
      permissions: [],
      locale: 'ar',
    } as AccessTokenClaims;

    enforcement = build();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /* ── ① Every one of the five events notifies, on both channels ─────────── */

  it('notifies when a warning is issued', async () => {
    await enforcement.warn(staff, await violation(), { note: REASON });

    expect(sent.map((s) => s.channel).sort()).toStrictEqual(['email', 'in_app']);
    expect(sent.every((s) => s.templateKey === 'partner.warned')).toBe(true);
  });

  it('notifies when a fine is imposed', async () => {
    await enforcement.fine(staff, await violation(), {
      amount: '50.00',
      currencyCode: 'USD',
      reason: REASON,
    });

    expect(sent.map((s) => s.channel).sort()).toStrictEqual(['email', 'in_app']);
    expect(sent.every((s) => s.templateKey === 'partner.fined')).toBe(true);
  });

  it('notifies when the partner is suspended', async () => {
    await enforcement.suspend(staff, reference, { reason: REASON });

    expect(sent.map((s) => s.channel).sort()).toStrictEqual(['email', 'in_app']);
    expect(sent.every((s) => s.templateKey === 'partner.suspended')).toBe(true);
  });

  it('notifies when the suspension is lifted', async () => {
    await enforcement.suspend(staff, reference, { reason: REASON });
    sent = [];

    await enforcement.unsuspend(staff, reference, { reason: REASON });

    expect(sent.map((s) => s.channel).sort()).toStrictEqual(['email', 'in_app']);
    expect(sent.every((s) => s.templateKey === 'partner.unsuspended')).toBe(true);
  });

  it('notifies when a fine is waived', async () => {
    await enforcement.waive(staff, await violation(true), { reason: REASON });

    expect(sent.map((s) => s.channel).sort()).toStrictEqual(['email', 'in_app']);
    expect(sent.every((s) => s.templateKey === 'partner.fine_waived')).toBe(true);
  });

  /* ── ② The recipient and the locale ────────────────────────────────────── */

  /**
   * The ACCOUNT address, not the application's — `O-partner-11`.
   *
   * The fixture sets `partners.email` to a different address on purpose, so this fails against the
   * implementation that shipped rather than passing against both.
   */
  it('addresses the notice to the sign-in account, not partners.email', async () => {
    await enforcement.suspend(staff, reference, { reason: REASON });

    const email = sent.find((s) => s.channel === 'email');

    expect(email?.to).toBe(accountEmail);
    expect(email?.to).not.toContain('notif-application');
  });

  /** The partner account's own language, whatever the operator's was. */
  it('uses the partner account’s preferred locale, not the actor’s', async () => {
    await enforcement.suspend(staff, reference, { reason: REASON });

    /* The fixture account is `de`; the acting staff member is `ar`. */
    expect(sent.every((s) => s.locale === 'de')).toBe(true);
  });

  /* ── ③ A failed notice never undoes the decision ───────────────────────── */

  /**
   * The rule that outranks every other one here.
   *
   * *"A notification delivery failure must not roll back the enforcement action."* Both channels are
   * made to throw, and the suspension must still stand — a partner still trading because SMTP was
   * slow is the wrong direction for this particular failure.
   */
  it('keeps the suspension when BOTH channels fail', async () => {
    const failing = build({ failing: true });

    await failing.suspend(staff, reference, { reason: REASON });

    const row = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM partners
      WHERE id = ${partnerId}::uuid AND suspended_at IS NOT NULL
    `);

    expect(row.rows[0]?.n).toBe(1);
  });

  /** And the same for the money path, where a rollback would unwind ledger entries. */
  it('keeps the waiver when BOTH channels fail', async () => {
    const failing = build({ failing: true });
    const id = await violation(true);

    await failing.waive(staff, id, { reason: REASON });

    const row = await db.execute<{ waived: string | null }>(sql`
      SELECT waived_at::text AS waived FROM partner_violations WHERE id = ${id}::uuid
    `);

    expect(row.rows[0]?.waived).not.toBeNull();
  });

  /* ── ④ The audit distinguishes the decision from the delivery ──────────── */

  /**
   * Two rows, two facts.
   *
   * *"The audit trail must distinguish the enforcement action from the notification delivery
   * result."* `partner.suspended` says a person decided; `partner.notified` says whether the partner
   * was told. One row carrying both would make a delivery failure indistinguishable from a decision
   * that never happened.
   */
  it('records the decision and the delivery as separate audit entries', async () => {
    await enforcement.suspend(staff, reference, { reason: REASON });

    const actions = await db.execute<{ action: string }>(sql`
      SELECT action FROM audit_log WHERE subject_id = ${partnerId}::uuid ORDER BY created_at
    `);

    expect(actions.rows.map((r) => r.action)).toStrictEqual([
      'partner.suspended',
      'partner.notified',
    ]);
  });

  /** A failure is audited too — the case an investigator most needs to find. */
  it('audits the delivery result even when both channels failed', async () => {
    const failing = build({ failing: true });

    await failing.suspend(staff, reference, { reason: REASON });

    const rows = await notices();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toContain('"inApp": "failed"');
    expect(rows[0]?.payload).toContain('"email": "failed"');
  });

  /**
   * And the audit payload carries NO address.
   *
   * The recipient is identified by the partner id the row already points at. Asserted by walking the
   * whole payload rather than naming a field: a privacy check phrased as "this string is absent"
   * only ever protects the string it names, and the next contact detail added beside it would walk
   * straight around a narrower test.
   */
  it('never writes an email address into the delivery audit', async () => {
    await enforcement.suspend(staff, reference, { reason: REASON });

    const rows = await notices();

    expect(rows[0]?.payload).not.toContain('@');
  });
});
