import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { DisputeNotifier } from './dispute-notifier.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { Env } from '../config/env.js';
import type { NotificationService } from '../notifications/notification.service.js';

/**
 * A closed dispute reaches the two people it is about.
 *
 * ## What was wrong
 *
 * `close()` released the partner's frozen payout, could credit the customer's wallet, and told
 * NOBODY — a customer found out by opening the app on the off chance, a partner by noticing money
 * had moved. Reported in the النزاعات review of 2026-08-27 and closed the next day.
 *
 * ## What is asserted here rather than in the template tests
 *
 * `mail.templates.test.ts` proves every message is Arabic first with English underneath, in every
 * locale. It cannot show that anything SENDS them. So this holds the wiring: who is written to,
 * with which template, in whose language — and that a failure to send cannot make a settled dispute
 * look unsettled.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('announcing a closed dispute', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  /** Every `notify` call, so «who was told what» is a list rather than a guess. */
  let sent: {
    key: string;
    to: string;
    locale: string;
    subject: string;
    text: string;
  }[] = [];
  /**
   * Which template key `notify` should refuse — the case where a mail server is down.
   *
   * ONE key rather than a flag, deliberately. Refusing everything cannot tell «this failure was
   * contained» from «this failure stopped the rest»: both leave nothing sent and both record two
   * failures. Refusing only the customer's message makes the partner's the discriminator, and a
   * mutation that lets the first error escape then fails here.
   */
  let refuse: string | null = null;

  const notifications = {
    notify: (
      key: string,
      mail: { to: string; subject: string; text: string },
      locale: string,
    ) => {
      if (refuse === key) return Promise.reject(new Error('SMTP is down'));

      sent.push({ key, to: mail.to, locale, subject: mail.subject, text: mail.text });

      return Promise.resolve();
    },
  } as unknown as NotificationService;

  const env = {
    APP_URL: 'https://safra.test',
    PARTNER_URL: 'https://partner.safra.test',
  } as unknown as Env;

  const notifier = new DisputeNotifier(db, env, notifications, new AuditService(db));

  const staff = { sub: undefined, role: 'super_admin' } as unknown as AccessTokenClaims;

  let disputeId = '';
  let reference = '';

  beforeEach(async () => {
    await harness.begin();
    sent = [];
    refuse = null;

    /*
      A whole dispute, on its own booking, with a customer and a partner who each have an address
      and a language. Both languages differ from the default so «in whose language» is a real
      question rather than one the default answers by accident.
    */
    const made = await db.execute<{ id: string; reference: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1)   AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')             AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                    AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                     AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)             AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES (${`dn-c-${randomUUID()}@safra.test`}, '+963900000150', 'customer', 'active', 'de')
        RETURNING id, email
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'صاحب الشكوى', cu.email, '+963900000150', false FROM cu
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES (${`dn-p-${randomUUID()}@safra.test`}, '+963900000151', 'partner', 'active', 'en')
        RETURNING id, email
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Notifier Test', 'شريك الإشعار', ref.city_id, 'x',
               '+963900000151', pu.email, 'approved'
        FROM pu, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               ${`dn-${randomUUID()}`}, 'عقار', 'Property', 'Objekt', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id FROM pr, ref
        RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot, paid_at)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 2200, current_date + 2202, 2, 'confirmed'::booking_status,
               '100.00', '9.00', '9.00', '0.0700', '7.00', '109.00', '93.00',
               ref.currency_id, '13000.00000000', '1417000.00', '{"code":"flex"}'::jsonb, now()
        FROM cp, un, pr, ref RETURNING id
      )
      INSERT INTO disputes (booking_id, partner_id, customer_profile_id, kind, status, title,
                            resolution, closed_at)
      SELECT bk.id, pr.partner_id, cp.id, 'not_as_described', 'resolved',
             'الغرفة لا تطابق الوصف', 'قُبلت الشكوى بعد مراجعة الصور.', now()
      FROM bk, pr, cp
      RETURNING id, reference
    `);

    const row = made.rows[0];

    if (!row) throw new Error('the notifier fixture built no dispute');

    disputeId = row.id;
    reference = row.reference;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /** The audit row this notifier always writes, whatever happened. */
  const audited = async (): Promise<Record<string, unknown> | undefined> => {
    const rows = await db.execute<{ after: Record<string, unknown> }>(sql`
      SELECT after FROM audit_log
      WHERE action = 'dispute.notified' AND subject_id = ${disputeId}::uuid
      -- Ordered by id as well, not by the timestamp alone (no backticks here: they would end
      -- this sql template). The rollback harness runs the whole suite in ONE transaction, so
      -- now() is identical for every row it writes and «the latest» is whatever the planner
      -- returns. The audit id is a uuidv7, which sorts by time.
      ORDER BY created_at DESC, id DESC LIMIT 1
    `);

    return rows.rows[0]?.after;
  };

  /**
   * BOTH people are written to, each in their own language.
   *
   * The pair is the assertion. Telling only the customer leaves a partner watching held money move
   * for no stated reason; telling only the partner leaves the person who complained to discover the
   * outcome by looking.
   */
  it('writes to the customer and to the partner, each in their own language', async () => {
    await notifier.closed(staff, disputeId, 'resolved');

    expect(sent.map((one) => one.key).sort()).toStrictEqual([
      'dispute.payout_released',
      'dispute.resolved',
    ]);

    const toCustomer = sent.find((one) => one.key === 'dispute.resolved');
    const toPartner = sent.find((one) => one.key === 'dispute.payout_released');

    expect(toCustomer?.locale, 'the customer chose German').toBe('de');
    expect(toPartner?.locale, 'the partner chose English').toBe('en');
    expect(toCustomer?.to).not.toBe(toPartner?.to);

    expect(await audited(), 'and both are recorded as queued').toStrictEqual({
      outcome: 'resolved',
      customer: 'queued',
      partner: 'queued',
    });
  });

  /**
   * BOTH parties are told what was decided, verbatim.
   *
   * ## This assertion used to say the opposite, and was changed on instruction
   *
   * It read «quotes the decision to the customer and withholds it from the partner», on the
   * reasoning that the resolution is between SAFRA and the customer and forwarding a verdict to
   * the party complained about puts a guest's words in front of them unasked. Bashar overruled it
   * on 2026-09-08, in the decision that gave the partner a voice in the case: *«The partner should
   * see the final decision and the reasoning that can be shared with them.»*
   *
   * He is right that the old shape was incoherent once they had one. A party who is asked to answer
   * an allegation and then told only that their money moved has been consulted, not heard — and
   * `resolution` was always documented as "the record a customer, a partner or an insurer asks to
   * see". What stays withheld is elsewhere and is asserted elsewhere: the customer's files, their
   * contact details, their wallet, and the internal notes, none of which any query here selects.
   */
  it('quotes the decision to both the customer and the partner', async () => {
    await notifier.closed(staff, disputeId, 'resolved');

    const toCustomer = sent.find((one) => one.key === 'dispute.resolved');
    const toPartner = sent.find((one) => one.key === 'dispute.payout_released');

    expect(toCustomer?.text, 'the decision reaches the person who complained').toContain(
      'قُبلت الشكوى بعد مراجعة الصور.',
    );
    expect(toPartner?.text, 'and the party it was made about').toContain(
      'قُبلت الشكوى بعد مراجعة الصور.',
    );

    /*
      The OUTCOME as a word, in the partner's own language — «the guest's complaint was upheld».

      The reasoning alone is not the decision: a resolution reading «the photographs were reviewed»
      leaves a host unable to tell which way it went. And it is asserted in ENGLISH because this
      partner chose English, which is what proves the per-block lookup works rather than pasting
      one language into three blocks.
    */
    expect(toPartner?.text, 'and says which way it went').toContain(
      'the guest’s complaint was upheld',
    );

    expect(toPartner?.text, 'and which dispute closed').toContain(reference);
  });

  /**
   * The two messages BEFORE a closure, which nobody sent until 223 was completed.
   *
   * A partner used to learn of a complaint against their property from a payout that had gone
   * quiet — the hold is applied the moment a dispute opens. Both events are the partner's alone:
   * the customer already knows they complained, and told twice is noise.
   */
  it('tells the partner a dispute was opened, and that somebody is looking at it', async () => {
    await notifier.opened(staff, disputeId);

    expect(sent.map((one) => one.key)).toStrictEqual(['partner.dispute_opened']);
    /* The ALLEGATION travels, because a message to answer a complaint must name the complaint. */
    expect(sent[0]?.text, 'the partner is told what they are answering').toContain(
      'الغرفة لا تطابق الوصف',
    );
    expect(sent[0]?.locale, 'in the language the partner chose').toBe('en');
    expect(await audited(), 'and it is recorded').toMatchObject({
      event: 'opened',
      partner: 'queued',
    });

    sent.length = 0;

    await notifier.underReview(staff, disputeId);

    expect(sent.map((one) => one.key)).toStrictEqual(['partner.dispute_under_review']);
    expect(sent[0]?.text, 'and which dispute it is').toContain(reference);
    expect(await audited()).toMatchObject({ event: 'under_review', partner: 'queued' });
  });

  /**
   * A failed pre-closure message does not throw, and the audit says it failed.
   *
   * The same rule the closure follows and for the same reason: the dispute is already recorded and
   * the payout is already frozen by the time this runs. A caller that saw an error here would
   * reasonably open the dispute again.
   */
  it('swallows a failure telling the partner, and records that it failed', async () => {
    refuse = 'partner.dispute_opened';

    await expect(notifier.opened(staff, disputeId)).resolves.toBeUndefined();

    expect(sent, 'nothing went').toStrictEqual([]);
    expect(await audited(), 'and the record says so').toMatchObject({
      event: 'opened',
      partner: 'failed',
    });
  });

  /** A rejection is a different message, not the same one with a different word. */
  it('sends the rejection template when the complaint was not upheld', async () => {
    await notifier.closed(staff, disputeId, 'rejected');

    expect(sent.map((one) => one.key).sort()).toStrictEqual([
      'dispute.payout_released',
      'dispute.rejected',
    ]);
    expect((await audited())?.customer).toBe('queued');
  });

  /**
   * THE assertion about failure: a mail server being down cannot make a settled dispute look
   * unsettled, and the audit says what did not happen.
   *
   * `close()` has already committed by the time this runs. If this threw, a staff member would see
   * a refusal for an action that succeeded, and would reasonably do it again.
   */
  it('contains a failure to one recipient, and records it', async () => {
    refuse = 'dispute.resolved';

    await expect(notifier.closed(staff, disputeId, 'resolved')).resolves.toBeUndefined();

    /*
      The PARTNER was still written to. That is the assertion: an error reaching the outer handler
      would abandon the second message, and a settled dispute would leave one of the two people it
      concerns uninformed for a reason that had nothing to do with them.
    */
    expect(
      sent.map((one) => one.key),
      'the other message still went',
    ).toStrictEqual(['dispute.payout_released']);

    expect(await audited(), 'and the record says which one did not').toStrictEqual({
      outcome: 'resolved',
      customer: 'failed',
      partner: 'queued',
    });
  });
});
