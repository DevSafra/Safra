import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';

import { MessagingService } from './messaging.service.js';
import { SupportService } from '../support/support.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import type { MailService } from '../mail/mail.service.js';
import type { Env } from '../config/env.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Telling the asker that their support ticket has an answer.
 *
 * ## Why these are about the NOTIFICATION rather than about the reply
 *
 * Posting the reply was already covered. What is new is that a staff reply now leaves the building:
 * it puts a row in `notifications` and a message in somebody's inbox. Three things can go wrong with
 * that and none of them is visible from the console — the email can carry text that was redacted out
 * of the database, an INTERNAL note can announce itself to the person it was hidden from, and a
 * German customer can be written to in Arabic.
 *
 * ## A real `NotificationService` over a stub transport
 *
 * Same reasoning as `reviews/review.integration.test.ts`: what has to be asserted is the delivery
 * ROW, so a mocked notifier that only counted calls would leave the log unwritten and the leak
 * unprovable. SMTP is not the subject, so the transport is a stub that records what it was handed.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** A ticket body with no digits — the redactor rewrites anything that looks like a phone number. */
const ASKED = 'The boiler on the fourth floor has been cold since we arrived.';

/**
 * The staff answer, and the string every leak test looks for.
 *
 * Deliberately distinctive: `toContain('scaffold')` over the whole notification row catches a body
 * that reaches ANY column, including one added after this test was written.
 */
const ANSWERED =
  'An engineer is booked for tomorrow morning; the scaffold is already up.';

describeIfDb('MessagingService — telling the asker a reply arrived', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  const db: Database = harness.db;

  const sentMail: { to: string; subject: string; text: string }[] = [];
  /* Set by the test that proves a reply survives an unreachable mail server. */
  let failNextSend = false;
  const mail = {
    send: (message: { to: string; subject: string; text: string }) => {
      if (failNextSend) {
        failNextSend = false;

        return Promise.reject(new Error('SMTP refused the message for x@example.test'));
      }

      sentMail.push(message);

      return Promise.resolve();
    },
  } as unknown as MailService;

  const notifications = new NotificationService(db, mail);
  const messaging = new MessagingService(db, notifications, {
    APP_URL: 'http://localhost:3000',
    PARTNER_URL: 'http://localhost:3002',
  } as unknown as Env);
  /* The asking side, so the ticket under test is built the way a real one is. */
  const support = new SupportService(db);

  let customerProfileId = '';
  let customerUserId = '';
  let partnerId = '';
  let partnerUserId = '';
  let staffUserId = '';
  let bookingId = '';

  const customer = (): AccessTokenClaims => ({
    sub: customerUserId,
    role: 'customer',
    permissions: [],
    locale: 'ar',
    customerProfileId,
  });

  const partner = (): AccessTokenClaims => ({
    sub: partnerUserId,
    role: 'partner',
    permissions: [],
    locale: 'ar',
    partnerId,
  });

  /** The console is Arabic-only, so the agent's own locale is never the recipient's. */
  const agent = (): AccessTokenClaims => ({
    sub: staffUserId,
    role: 'support_agent',
    permissions: [],
    locale: 'ar',
  });

  /** The newest delivery row for a template, whatever its outcome. */
  const logFor = async (templateKey: string) =>
    (
      await db.execute<{
        template_key: string;
        locale: string;
        status: string;
        booking_id: string | null;
        dispute_id: string | null;
        customer_profile_id: string | null;
        partner_id: string | null;
        failure_reason: string | null;
      }>(sql`
        SELECT template_key, locale, status::text AS status,
               booking_id, dispute_id, customer_profile_id, partner_id, failure_reason
        FROM notifications
        WHERE template_key = ${templateKey}
        ORDER BY queued_at DESC
        LIMIT 1
      `)
    ).rows[0];

  const countOf = async (templateKey: string) =>
    Number(
      (
        await db.execute<{ n: string }>(sql`
          SELECT count(*)::text AS n FROM notifications WHERE template_key = ${templateKey}
        `)
      ).rows[0]?.n ?? 0,
    );

  beforeEach(async () => {
    await harness.begin();
    await seed();
    sentMail.length = 0;
    failNextSend = false;
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  // ─── The notice itself ─────────────────────────────────────────────────────

  it('emails the customer that their ticket has an answer, and records that it did', async () => {
    const ticket = await support.open(customer(), ASKED);

    await messaging.reply(agent(), ticket.reference, {
      body: ANSWERED,
      internal: false,
    });

    const row = await logFor('support.replied');

    expect(row?.status).toBe('sent');
    /* Addressed from the THREAD's own customer, not from anything the agent supplied. */
    expect(row?.customer_profile_id).toBe(customerProfileId);
    expect(row?.partner_id).toBeNull();
    expect(sentMail).toHaveLength(1);
  });

  it('sends the reference and a link to the thread, and nothing else to act on', async () => {
    const ticket = await support.open(customer(), ASKED);

    await messaging.reply(agent(), ticket.reference, {
      body: ANSWERED,
      internal: false,
    });

    expect(sentMail[0]?.subject).toContain(ticket.reference);
    expect(sentMail[0]?.text).toContain(
      `http://localhost:3000/ar/account/support/${ticket.reference}`,
    );
  });

  it("writes to the partner's own console on a partner's ticket", async () => {
    const ticket = await support.open(partner(), ASKED);

    await messaging.reply(agent(), ticket.reference, {
      body: ANSWERED,
      internal: false,
    });

    const row = await logFor('support.replied');

    expect(row?.partner_id).toBe(partnerId);
    expect(row?.customer_profile_id).toBeNull();
    expect(sentMail[0]?.text).toContain(
      `http://localhost:3002/support/${ticket.reference}`,
    );
  });

  // ─── The leak this feature could cause ─────────────────────────────────────

  /**
   * An internal note is how staff talk to each other INSIDE the thread, and every read the customer
   * performs filters it out. A notice about one would announce its existence to the person it was
   * hidden from — and «ردّ فريق الدعم على طلبك» followed by a page with nothing new on it is the
   * mildest way that goes wrong.
   */
  it('says nothing at all when the reply is an internal note', async () => {
    const ticket = await support.open(customer(), ASKED);

    await messaging.reply(agent(), ticket.reference, {
      body: 'Refunded twice already this year — check with finance before offering anything.',
      internal: true,
    });

    expect(await countOf('support.replied')).toBe(0);
    expect(sentMail).toHaveLength(0);
  });

  /** And the note still posts: silence is about the notice, not about the message. */
  it('still records the internal note in the thread', async () => {
    const ticket = await support.open(customer(), ASKED);

    const thread = await messaging.reply(agent(), ticket.reference, {
      body: 'Checked with finance.',
      internal: true,
    });

    expect(thread.filter((message) => message.internal)).toHaveLength(1);
    /* The customer's own view of the same thread is unchanged. */
    const asked = await support.thread(customer(), ticket.reference);

    expect(asked.messages).toHaveLength(1);
  });

  /**
   * The body is stored REDACTED and the original is deliberately not kept (`db/schema/messaging.ts`).
   * Repeating the text in an email or in the delivery log would put back exactly what the redaction
   * removed — into an inbox, and into a table every support agent reads.
   */
  it('never puts the message body in the notification row or in the email', async () => {
    const ticket = await support.open(customer(), ASKED);

    await messaging.reply(agent(), ticket.reference, {
      body: ANSWERED,
      internal: false,
    });

    const row = await logFor('support.replied');

    /* Every column at once, so a column added later is covered without editing this test. */
    expect(JSON.stringify(row)).not.toContain('scaffold');
    expect(sentMail[0]?.text).not.toContain('scaffold');
    /* Nor the question that was asked — the thread is the record, the email is a pointer. */
    expect(sentMail[0]?.text).not.toContain('boiler');
  });

  // ─── Who it is written to, and in what language ────────────────────────────

  /**
   * The agent writing the reply is Arabic-only by construction, so an implementation that took the
   * locale from the actor would send every German customer Arabic and no test would fail.
   */
  it("writes in the recipient's language, not the agent's", async () => {
    await db.execute(sql`
      UPDATE customer_profiles SET preferred_locale = 'de' WHERE id = ${customerProfileId}::uuid
    `);

    const ticket = await support.open(customer(), ASKED);

    await messaging.reply(agent(), ticket.reference, {
      body: ANSWERED,
      internal: false,
    });

    const row = await logFor('support.replied');

    expect(row?.locale).toBe('de');
    expect(sentMail[0]?.subject).toContain('Support-Team');
    /* The link follows the language it is written in, or it lands on a page in another one. */
    expect(sentMail[0]?.text).toContain('/de/account/support/');
  });

  /** `preferred_locale` is an unconstrained text column, so this is reachable from data. */
  it('falls back to Arabic for a locale the platform does not serve', async () => {
    await db.execute(sql`
      UPDATE customer_profiles SET preferred_locale = 'fr' WHERE id = ${customerProfileId}::uuid
    `);

    const ticket = await support.open(customer(), ASKED);

    await messaging.reply(agent(), ticket.reference, {
      body: ANSWERED,
      internal: false,
    });

    expect((await logFor('support.replied'))?.locale).toBe('ar');
    expect(sentMail[0]?.text).toContain('/ar/account/support/');
  });

  /** A suspended account is not written to, and the reply still posts. */
  it('does not email an account that can no longer sign in', async () => {
    const ticket = await support.open(customer(), ASKED);

    await db.execute(sql`
      UPDATE users SET status = 'suspended' WHERE id = ${customerUserId}::uuid
    `);

    const thread = await messaging.reply(agent(), ticket.reference, {
      body: ANSWERED,
      internal: false,
    });

    expect(thread).toHaveLength(2);
    expect(await countOf('support.replied')).toBe(0);
  });

  /**
   * Tickets only.
   *
   * A booking thread has two parties and no route into it from either dashboard — الدعم lists
   * subject-less threads, so `SupportService` answers 404 for a booking thread's reference. A notice
   * linking to one would send somebody to a page they cannot open.
   */
  it('says nothing on a thread that belongs to a booking', async () => {
    const created = await db.execute<{ reference: string }>(sql`
      INSERT INTO conversations (booking_id, customer_profile_id, last_message_at, unread_for_staff)
      VALUES (${bookingId}::uuid, ${customerProfileId}::uuid, now(), 1)
      RETURNING reference
    `);

    const reference = created.rows[0]?.reference ?? '';

    await messaging.reply(agent(), reference, { body: ANSWERED, internal: false });

    expect(await countOf('support.replied')).toBe(0);
    expect(sentMail).toHaveLength(0);
  });

  // ─── When the send fails ───────────────────────────────────────────────────

  /**
   * The reply is the fact; the notice is a consequence. A mail server that is down must not undo a
   * support answer — and the failure has to be VISIBLE, because "we tried and could not reach them"
   * is a different answer from "we never tried".
   */
  it('posts the reply even when the notice cannot be sent, and records the failure', async () => {
    const ticket = await support.open(customer(), ASKED);

    failNextSend = true;

    const thread = await messaging.reply(agent(), ticket.reference, {
      body: ANSWERED,
      internal: false,
    });

    expect(thread).toHaveLength(2);

    const row = await logFor('support.replied');

    expect(row?.status).toBe('failed');
    expect(row?.failure_reason).toBeTruthy();
    /* Never the recipient: this table is read by more people than the database. */
    expect(row?.failure_reason).not.toContain('@');
  });

  /**
   * Everything one test needs, in one statement.
   *
   * Emails are suffixed with `gen_random_uuid()` because `users_email_unique` is a real index and
   * vitest runs test FILES in parallel — a fixed address collides with whatever else is mid-rollback.
   */
  async function seed(): Promise<void> {
    const made = await db.execute<{
      customer_profile_id: string;
      customer_user_id: string;
      partner_id: string;
      partner_user_id: string;
      staff_user_id: string;
      booking_id: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD') AS currency_id,
               (SELECT id FROM property_types LIMIT 1) AS type_id,
               (SELECT id FROM partner_types LIMIT 1) AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1) AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('msg-customer-' || gen_random_uuid() || '@safra.test', '+963900000060',
                'customer', 'active', 'ar')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('msg-partner-' || gen_random_uuid() || '@safra.test', '+963900000061',
                'partner', 'active', 'ar')
        RETURNING id
      ), su AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('msg-agent-' || gen_random_uuid() || '@safra.test', '+963900000062',
                'support_agent', 'active', 'ar')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest,
                                       preferred_locale)
        SELECT cu.id, 'زبون الدعم',
               'msg-customer-' || gen_random_uuid() || '@safra.test',
               '+963900000060', false, 'ar'
        FROM cu RETURNING id, user_id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Messaging Test', 'شريك الدعم', ref.city_id, 'x',
               '+963900000061', 'msg-partner-' || gen_random_uuid() || '@safra.test',
               'approved'
        FROM pu, ref RETURNING id, user_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'msg-test-' || gen_random_uuid(), 'اختبار', 'Test', 'Test', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Unit', 2, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      ), b AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date, current_date + 2, 2, 'confirmed'::booking_status,
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '12500.00000000', '2524875.00', '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref
        RETURNING id
      )
      SELECT cp.id AS customer_profile_id, cp.user_id AS customer_user_id,
             pa.id AS partner_id, pa.user_id AS partner_user_id,
             su.id AS staff_user_id, b.id AS booking_id
      FROM cp, pa, su, b
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    customerProfileId = row.customer_profile_id;
    customerUserId = row.customer_user_id;
    partnerId = row.partner_id;
    partnerUserId = row.partner_user_id;
    staffUserId = row.staff_user_id;
    bookingId = row.booking_id;
  }
});
