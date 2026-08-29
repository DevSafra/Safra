import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { MessagingService } from './messaging.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { ReviewService } from './review.service.js';
import { SupportService } from '../support/support.service.js';
import { createInlineMailQueue } from '../queue/queue.testing.js';
import type { MailService } from '../mail/mail.service.js';
import type { Env } from '../config/env.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * SAFRA writing first — «محادثة جديدة», and the three-party thread it can finally open.
 *
 * ## The gap (الرسائل review, 2026-08-29)
 *
 * `INSERT INTO conversations` had two callers and neither was staff. الرسائل was a reply-only
 * inbox: an operator could answer somebody who had written in and could not write to anybody.
 * Bashar asked how to message a customer, a partner, or both at once; the answer was that there was
 * no way to do any of it, and «both at once» — the booking thread the design has described since
 * the first migration — had never existed at all.
 *
 * ## Every case has its opposite
 *
 * A thread nobody can read is worse than no thread, and that is the failure this feature invites:
 * writing into a row neither dashboard lists. So each case that opens one also asserts the intended
 * reader gets it AND that the wrong reader does not.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const WRITTEN = 'راجعنا حجزك ونحتاج تأكيد موعد الوصول قبل الغد.';

describeIfDb('starting a conversation from the console', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const sentMail: { to: string; subject: string; text: string }[] = [];
  const mail = {
    send: (message: { to: string; subject: string; text: string }) => {
      sentMail.push(message);

      return Promise.resolve();
    },
  } as unknown as MailService;

  const mailQueue = createInlineMailQueue();
  const notifications = new NotificationService(db, mail, mailQueue.queue);

  mailQueue.autoRun = (job) =>
    notifications.deliver(job.notificationId, job.templateKey, job.mail);

  const messaging = new MessagingService(db, new AuditService(db), notifications, {
    APP_URL: 'http://localhost:3000',
    PARTNER_URL: 'http://localhost:3002',
  } as unknown as Env);
  const support = new SupportService(db);
  /* Only `attentionCounts` is exercised here, and it touches none of the other four. */
  const reviews = new ReviewService(
    db,
    new AuditService(db),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  let home: string | null = null;
  let away: string | null = null;
  let bookingReference = '';
  let customerReference = '';
  let partnerReference = '';
  let customerProfileId = '';
  let customerUserId = '';
  let strangerProfileId = '';
  let strangerUserId = '';
  let partnerId = '';
  let partnerUserId = '';
  let employeeUserId = '';
  let staffUserId = '';

  const customer = (): AccessTokenClaims => ({
    sub: customerUserId,
    role: 'customer',
    permissions: [],
    locale: 'ar',
    customerProfileId,
  });

  /** A different customer entirely — the control on «is this thread mine». */
  const stranger = (): AccessTokenClaims => ({
    sub: strangerUserId,
    role: 'customer',
    permissions: [],
    locale: 'ar',
    customerProfileId: strangerProfileId,
  });

  const host = (): AccessTokenClaims => ({
    sub: partnerUserId,
    role: 'partner',
    permissions: [],
    locale: 'ar',
    partnerId,
  });

  /** An employee of the same business, who reads only what they opened. */
  const employee = (): AccessTokenClaims => ({
    sub: employeeUserId,
    role: 'partner_employee',
    permissions: [],
    locale: 'ar',
    partnerId,
  });

  const agent = (): AccessTokenClaims => ({
    sub: staffUserId,
    role: 'support_agent',
    permissions: [],
    locale: 'ar',
  });

  const scopedTo = (...cityIds: (string | null)[]): AccessTokenClaims =>
    ({
      sub: staffUserId,
      role: 'operations_manager',
      permissions: [],
      scope: { kind: 'cities', cityIds: cityIds.filter(Boolean), outside: 'none' },
    }) as unknown as AccessTokenClaims;

  const readOnlyOutside = (...cityIds: (string | null)[]): AccessTokenClaims =>
    ({
      sub: staffUserId,
      role: 'operations_manager',
      permissions: [],
      scope: { kind: 'cities', cityIds: cityIds.filter(Boolean), outside: 'read_only' },
    }) as unknown as AccessTokenClaims;

  /** The conversation row behind a reference, straight from the table. */
  const rowOf = async (reference: string) =>
    (
      await db.execute<{
        booking_id: string | null;
        partner_id: string | null;
        customer_profile_id: string | null;
        unread_for_staff: number;
        messages: number;
        sender_kind: string | null;
        body: string | null;
      }>(sql`
        SELECT c.booking_id, c.partner_id, c.customer_profile_id, c.unread_for_staff,
               (SELECT count(*) FROM messages WHERE conversation_id = c.id)::int AS messages,
               m.sender_kind::text AS sender_kind, m.body
        FROM conversations c
        LEFT JOIN LATERAL (
          SELECT sender_kind, body FROM messages
          WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
        ) m ON TRUE
        WHERE c.reference = ${reference}
      `)
    ).rows[0];

  beforeEach(async () => {
    await harness.begin();

    const cities = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM cities WHERE deleted_at IS NULL ORDER BY id LIMIT 2`);

    home = cities.rows[0]?.id ?? null;
    away = cities.rows[1]?.id ?? null;

    expect(home, 'a city to hold the booking').toBeTruthy();
    expect(away, 'and a different one to be scoped away from').toBeTruthy();

    await seed(home);
    sentMail.length = 0;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /* ── A customer ───────────────────────────────────────────────────────────── */

  it('writes to a customer, and the customer reads it in الدعم', async () => {
    const started = await messaging.start(agent(), {
      to: 'customer',
      reference: customerReference,
      body: WRITTEN,
    });

    expect(started.created).toBe(true);

    const row = await rowOf(started.reference);

    expect(row).toMatchObject({
      booking_id: null,
      partner_id: null,
      customer_profile_id: customerProfileId,
      sender_kind: 'staff',
      /* Staff wrote it; a thread unread to its own author inflates the badge. */
      unread_for_staff: 0,
    });

    /* The control that makes the thread worth opening: the customer can actually read it. */
    const seen = await support.thread(customer(), started.reference);

    expect(seen.messages[0]?.body).toContain('نحتاج تأكيد موعد الوصول');

    /* And somebody else's customer cannot. */
    await expect(support.thread(stranger(), started.reference)).rejects.toMatchObject({
      response: { code: ERROR.SUPPORT_TICKET_NOT_FOUND },
    });
  });

  it('tells the customer there is a message waiting', async () => {
    const started = await messaging.start(agent(), {
      to: 'customer',
      reference: customerReference,
      body: WRITTEN,
    });

    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]?.text).toContain(
      `http://localhost:3000/ar/account/support/${started.reference}`,
    );
  });

  /* ── A partner ────────────────────────────────────────────────────────────── */

  it('writes to a host, and the owner reads it while an employee does not', async () => {
    const started = await messaging.start(agent(), {
      to: 'partner',
      reference: partnerReference,
      body: WRITTEN,
    });

    const row = await rowOf(started.reference);

    expect(row).toMatchObject({
      booking_id: null,
      partner_id: partnerId,
      customer_profile_id: null,
      sender_kind: 'staff',
    });

    await expect(support.thread(host(), started.reference)).resolves.toMatchObject({
      reference: started.reference,
    });

    /*
      An employee reads only threads they opened, and SAFRA opened this one. Deny by default: an
      employee who needs it asks the owner, and widening that is a decision somebody makes on
      purpose rather than a side effect.
    */
    await expect(support.thread(employee(), started.reference)).rejects.toMatchObject({
      response: { code: ERROR.SUPPORT_TICKET_NOT_FOUND },
    });
  });

  /* ── Both at once ─────────────────────────────────────────────────────────── */

  /**
   * The three-party thread, which is what «both of them at the same time» means.
   *
   * `conversations.booking_id` has existed since the first migration with NO writer, so the shape
   * the whole design describes — customer, SAFRA, host, one ordered record — had never once been
   * created. Both sides reading the SAME thread is the assertion; two threads would be two
   * conversations, which is the thing this exists not to be.
   */
  it('opens one thread on a booking that both the customer and the host read', async () => {
    const started = await messaging.start(agent(), {
      to: 'booking',
      reference: bookingReference,
      body: WRITTEN,
    });

    const row = await rowOf(started.reference);

    expect(row).toMatchObject({
      partner_id: null,
      /* Named as a participant, which the CHECK counts as no second subject. */
      customer_profile_id: customerProfileId,
      sender_kind: 'staff',
    });
    expect(row?.booking_id).toBeTruthy();

    const asCustomer = await support.thread(customer(), started.reference);
    const asHost = await support.thread(host(), started.reference);

    expect(asCustomer.reference).toBe(started.reference);
    expect(asHost.reference).toBe(started.reference);
    expect(asCustomer.messages[0]?.body).toBe(asHost.messages[0]?.body);

    /* A customer with no stake in that booking still gets nothing. */
    await expect(support.thread(stranger(), started.reference)).rejects.toMatchObject({
      response: { code: ERROR.SUPPORT_TICKET_NOT_FOUND },
    });

    /* Both are told, each pointed at their own dashboard. */
    const links = sentMail.map((message) => message.text).join('\n');

    expect(sentMail).toHaveLength(2);
    expect(links).toContain(
      `http://localhost:3000/ar/account/support/${started.reference}`,
    );
    expect(links).toContain(`http://localhost:3002/support/${started.reference}`);
  });

  /**
   * The booking is the authorization, not only the participant column.
   *
   * `start` names the customer on every booking thread it opens, so the clause that reaches them
   * THROUGH the booking is unreachable from that path — a mutation removing it left this suite
   * green. The CHECK allows a booking thread with no participant named, so this fixture builds one
   * and the clause becomes load-bearing: a writer that forgets the column must not silently take
   * the thread away from the person whose booking it is.
   */
  it('reaches a booking thread through the booking, with no participant named', async () => {
    const made = await db.execute<{ reference: string }>(sql`
      INSERT INTO conversations (booking_id, last_message_at, unread_for_staff)
      SELECT id, now(), 0 FROM bookings WHERE reference = ${bookingReference}
      RETURNING reference
    `);

    const reference = made.rows[0]?.reference ?? '';

    await expect(support.thread(customer(), reference)).resolves.toMatchObject({
      reference,
    });
    await expect(support.thread(host(), reference)).resolves.toMatchObject({ reference });

    /* And it is still nobody else's. */
    await expect(support.thread(stranger(), reference)).rejects.toMatchObject({
      response: { code: ERROR.SUPPORT_TICKET_NOT_FOUND },
    });
  });

  it('lets both sides answer into the same thread', async () => {
    const started = await messaging.start(agent(), {
      to: 'booking',
      reference: bookingReference,
      body: WRITTEN,
    });

    await support.reply(customer(), started.reference, 'سنصل قرابة الثامنة مساءً.');
    await support.reply(host(), started.reference, 'تمام، سيكون الاستقبال بانتظاركم.');

    const seen = await support.thread(customer(), started.reference);

    expect(seen.messages).toHaveLength(3);
    /* Both answers reach the console's own view of the thread, in order. */
    const staffView = await messaging.thread(started.reference, agent());

    expect(staffView.messages.map((message) => message.senderKind)).toEqual([
      'staff',
      'customer',
      'partner',
    ]);
  });

  /* ── Continuing, rather than duplicating ──────────────────────────────────── */

  /**
   * Two messages to one customer made two rows that look identical in the inbox — same party, same
   * (absent) subject, nothing to tell them apart. That is half of what Bashar read as confusing.
   */
  it('adds to the open thread instead of opening a second', async () => {
    const first = await messaging.start(agent(), {
      to: 'customer',
      reference: customerReference,
      body: WRITTEN,
    });

    const second = await messaging.start(agent(), {
      to: 'customer',
      reference: customerReference,
      body: 'تذكير بشأن نفس الحجز.',
    });

    expect(second.reference).toBe(first.reference);
    expect(second.created).toBe(false);
    expect((await rowOf(first.reference))?.messages).toBe(2);
  });

  it('opens a new thread when the last one was closed', async () => {
    const first = await messaging.start(agent(), {
      to: 'customer',
      reference: customerReference,
      body: WRITTEN,
    });

    await messaging.close(agent(), first.reference);

    const second = await messaging.start(agent(), {
      to: 'customer',
      reference: customerReference,
      body: 'موضوع جديد تماماً.',
    });

    expect(second.reference).not.toBe(first.reference);
    expect(second.created).toBe(true);
  });

  /* ── What it refuses ──────────────────────────────────────────────────────── */

  it('refuses a recipient that does not exist', async () => {
    await expect(
      messaging.start(agent(), {
        to: 'customer',
        reference: 'CUS-000000',
        body: WRITTEN,
      }),
    ).rejects.toMatchObject({
      response: { code: ERROR.CONVERSATION_RECIPIENT_NOT_FOUND },
    });
  });

  /**
   * The two modes are owed different answers, and `assertCanWrite` gives them: a `none` member gets
   * a 404 indistinguishable from a host that does not exist, a `read_only` member gets a refusal
   * that names the reason. Asserted separately here and in the case below, because a single
   * «it throws» would pass over either one being wrong.
   */
  it('refuses a host in another city, and writes to one in its own', async () => {
    await expect(
      messaging.start(scopedTo(away), {
        to: 'partner',
        reference: partnerReference,
        body: WRITTEN,
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.REQUEST_NOT_FOUND } });

    /* The control: the operator whose city it is can write. */
    await expect(
      messaging.start(scopedTo(home), {
        to: 'partner',
        reference: partnerReference,
        body: WRITTEN,
      }),
    ).resolves.toMatchObject({ created: true });
  });

  it('refuses a read-only operator who may see the whole country', async () => {
    await expect(
      messaging.start(readOnlyOutside(away), {
        to: 'booking',
        reference: bookingReference,
        body: WRITTEN,
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.SCOPE_OUTSIDE } });
  });

  /** Staff are not exempt — a contact detail is masked on the way in, as it is from anybody. */
  it('masks a contact detail a staff member wrote', async () => {
    const started = await messaging.start(agent(), {
      to: 'customer',
      reference: customerReference,
      body: 'اتصل بنا على 0955123456 لتأكيد الموعد.',
    });

    const row = await rowOf(started.reference);

    expect(row?.body).not.toContain('0955123456');
  });

  /* ── Reading brings the badge down ────────────────────────────────────────── */

  /**
   * `unread_for_staff` was cleared by a reply and by a close and by nothing else, so a thread read
   * and judged to need no answer stayed counted for ever — the badge only went up.
   */
  it('clears the unread count when an agent reads the thread', async () => {
    const started = await messaging.start(agent(), {
      to: 'customer',
      reference: customerReference,
      body: WRITTEN,
    });

    /* The customer answers, which is what puts it back in the queue. */
    await support.reply(customer(), started.reference, 'شكراً، سنؤكد غداً.');

    const before = (await reviews.attentionCounts(agent()))['messages_unread'] ?? 0;

    expect((await rowOf(started.reference))?.unread_for_staff).toBe(1);

    await expect(messaging.markRead(agent(), started.reference)).resolves.toEqual({
      read: true,
    });

    expect((await rowOf(started.reference))?.unread_for_staff).toBe(0);

    const after = (await reviews.attentionCounts(agent()))['messages_unread'] ?? 0;

    expect(before - after).toBe(1);

    /* A second render changes nothing and says so. */
    await expect(messaging.markRead(agent(), started.reference)).resolves.toEqual({
      read: false,
    });
  });

  it('refuses to mark a thread read from another city', async () => {
    const started = await messaging.start(agent(), {
      to: 'booking',
      reference: bookingReference,
      body: WRITTEN,
    });

    await support.reply(customer(), started.reference, 'سؤال.');

    await expect(
      messaging.markRead(scopedTo(away), started.reference),
    ).rejects.toMatchObject({
      response: { code: ERROR.CONVERSATION_NOT_FOUND_OR_CLOSED },
    });

    /* The control: the city it belongs to can. */
    await expect(messaging.markRead(scopedTo(home), started.reference)).resolves.toEqual({
      read: true,
    });
  });

  async function seed(cityId: string | null): Promise<void> {
    const made = await db.execute<{
      booking_reference: string;
      customer_reference: string;
      partner_reference: string;
      customer_profile_id: string;
      customer_user_id: string;
      stranger_profile_id: string;
      stranger_user_id: string;
      partner_id: string;
      partner_user_id: string;
      employee_user_id: string;
      staff_user_id: string;
    }>(sql`
      WITH ref AS (
        SELECT ${cityId}::uuid AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')  AS currency_id,
               (SELECT id FROM property_types LIMIT 1)         AS type_id,
               (SELECT id FROM partner_types LIMIT 1)          AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)  AS policy_id
      ), st AS (
        INSERT INTO users (full_name, email, phone, role, status, preferred_locale)
        VALUES ('مدير العمليات', 'sc-s-' || gen_random_uuid() || '@safra.test',
                '+963900000101', 'operations_manager', 'active', 'ar')
        RETURNING id
      ), cu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('sc-c-' || gen_random_uuid() || '@safra.test', '+963900000102',
                'customer', 'active', 'ar')
        RETURNING id
      ), xu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('sc-x-' || gen_random_uuid() || '@safra.test', '+963900000103',
                'customer', 'active', 'ar')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('sc-p-' || gen_random_uuid() || '@safra.test', '+963900000104',
                'partner', 'active', 'ar')
        RETURNING id
      ), eu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('sc-e-' || gen_random_uuid() || '@safra.test', '+963900000105',
                'partner_employee', 'active', 'ar')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest,
                                       preferred_locale)
        SELECT cu.id, 'نزيل المحادثة', 'sc-c-' || gen_random_uuid() || '@safra.test',
               '+963900000102', false, 'ar'
        FROM cu RETURNING id, user_id, reference
      ), xp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest,
                                       preferred_locale)
        SELECT xu.id, 'نزيل آخر', 'sc-x-' || gen_random_uuid() || '@safra.test',
               '+963900000103', false, 'ar'
        FROM xu RETURNING id, user_id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Start Conversation', 'شريك المحادثة',
               ref.city_id, 'x', '+963900000104',
               'sc-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, user_id, reference
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'start-conv-' || gen_random_uuid(), 'عقار', 'Property', 'Property', 'x',
               'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 2, '100.00', ref.currency_id FROM pr, ref
        RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 400, current_date + 403, 2, 'confirmed'::booking_status, now(),
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref
        RETURNING reference
      )
      SELECT bk.reference AS booking_reference,
             cp.reference AS customer_reference,
             pa.reference AS partner_reference,
             cp.id AS customer_profile_id, cp.user_id AS customer_user_id,
             xp.id AS stranger_profile_id, xp.user_id AS stranger_user_id,
             pa.id AS partner_id, pa.user_id AS partner_user_id,
             eu.id AS employee_user_id, st.id AS staff_user_id
      FROM bk, cp, xp, pa, eu, st
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    bookingReference = row.booking_reference;
    customerReference = row.customer_reference;
    partnerReference = row.partner_reference;
    customerProfileId = row.customer_profile_id;
    customerUserId = row.customer_user_id;
    strangerProfileId = row.stranger_profile_id;
    strangerUserId = row.stranger_user_id;
    partnerId = row.partner_id;
    partnerUserId = row.partner_user_id;
    employeeUserId = row.employee_user_id;
    staffUserId = row.staff_user_id;
  }
});
