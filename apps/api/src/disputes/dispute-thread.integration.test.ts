import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { DisputeRequestService } from './dispute-request.service.js';
import { DisputeService } from '../admin/dispute.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MessagingService } from '../admin/messaging.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { ReviewService } from '../admin/review.service.js';
import { SupportService } from '../support/support.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { createInlineMailQueue } from '../queue/queue.testing.js';
import type { MailService } from '../mail/mail.service.js';
import type { Env } from '../config/env.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * A dispute opens with a conversation, and that conversation belongs to a city.
 *
 * ## The gap (الرسائل review, 2026-08-28)
 *
 * `conversations.dispute_id`, its foreign key and `conversations_dispute_idx` have existed since
 * the first migration and nothing ever wrote the column. Every conversation the platform held was
 * a support ticket, so the inbox's «نزاع» subject kind, its join to `disputes` and its branch
 * printing the dispute's reference were all unreachable — and an operator settling a complaint had
 * the customer's account of it on one screen, the evidence on another, and no way to ask the one
 * question that would settle it.
 *
 * ## The security half, which is the reason this file is long
 *
 * A conversation has no city; it inherits one from what it is about. The INBOX reached the partner
 * through the dispute and the four single-thread queries did not — they joined `c.partner_id`
 * alone, which is NULL on a dispute thread, and a NULL city reads as «platform-level, everybody
 * may». So the moment the column had a writer, a case in one city would have been absent from its
 * own operator's list and readable, repliable and closable by every operator in the country who
 * had the reference. Every case below has its opposite: the refusal, and the control proving the
 * right reader still succeeds.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const TITLE = 'الغرفة لا تطابق الصور المنشورة';
const ACCOUNT =
  'الغرفة تطل على موقف السيارات لا على الحديقة، والصور المنشورة تظهر الحديقة.';

describeIfDb('the conversation a dispute opens with', () => {
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

  const requests = new DisputeRequestService(db);
  const staffDisputes = new DisputeService(
    db,
    new AuditService(db),
    new WalletService(db, new FxRateService(db, new AuditService(db))),
    new LedgerService(db),
    new FxRateService(db, new AuditService(db)),
    /* The notifier only announces a closure; this suite is about the thread. */
    { closed: () => Promise.resolve() } as never,
  );
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
  let customerProfileId = '';
  let customerUserId = '';
  let strangerProfileId = '';
  let strangerUserId = '';
  let partnerId = '';
  let partnerUserId = '';
  let staffUserId = '';

  const customer = (): AccessTokenClaims => ({
    sub: customerUserId,
    role: 'customer',
    permissions: [],
    locale: 'ar',
    customerProfileId,
  });

  /** Unscoped — the whole country. */
  const agent = (): AccessTokenClaims => ({
    sub: staffUserId,
    role: 'support_agent',
    permissions: [],
    locale: 'ar',
  });

  /** A different customer entirely — the control on «is this thread mine». */
  const stranger = (): AccessTokenClaims => ({
    sub: strangerUserId,
    role: 'customer',
    permissions: [],
    locale: 'ar',
    customerProfileId: strangerProfileId,
  });

  /** The host the complaint is ABOUT — who must not be reading it. */
  const accused = (): AccessTokenClaims => ({
    sub: partnerUserId,
    role: 'partner',
    permissions: [],
    locale: 'ar',
    partnerId,
  });

  /** Restricted to `cities`, with no reach outside them. */
  const scopedTo = (...cityIds: (string | null)[]): AccessTokenClaims =>
    ({
      sub: staffUserId,
      role: 'operations_manager',
      permissions: [],
      scope: { kind: 'cities', cityIds: cityIds.filter(Boolean), outside: 'none' },
    }) as unknown as AccessTokenClaims;

  /** Restricted, but permitted to READ the rest of the country. */
  const readOnlyOutside = (...cityIds: (string | null)[]): AccessTokenClaims =>
    ({
      sub: staffUserId,
      role: 'operations_manager',
      permissions: [],
      scope: { kind: 'cities', cityIds: cityIds.filter(Boolean), outside: 'read_only' },
    }) as unknown as AccessTokenClaims;

  /** The thread on a dispute, straight from the table. */
  const threadOf = async (disputeReference: string) =>
    (
      await db.execute<{
        reference: string;
        customer_profile_id: string | null;
        booking_id: string | null;
        partner_id: string | null;
        unread_for_staff: number;
        sender_kind: string;
        body: string;
      }>(sql`
        SELECT c.reference, c.customer_profile_id, c.booking_id, c.partner_id,
               c.unread_for_staff, m.sender_kind::text AS sender_kind, m.body
        FROM conversations c
        JOIN disputes d ON d.id = c.dispute_id
        LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE d.reference = ${disputeReference}
        ORDER BY m.created_at ASC
        LIMIT 1
      `)
    ).rows[0];

  const openAsCustomer = async () =>
    (
      await requests.open(customer(), {
        bookingReference,
        kind: 'not_as_described',
        title: TITLE,
        description: ACCOUNT,
      })
    ).reference;

  beforeEach(async () => {
    await harness.begin();

    const cities = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM cities WHERE deleted_at IS NULL ORDER BY id LIMIT 2`);

    home = cities.rows[0]?.id ?? null;
    away = cities.rows[1]?.id ?? null;

    /* The fixture must be able to tell two cities apart, or the scope cases measure nothing. */
    expect(home, 'a city to hold the booking').toBeTruthy();
    expect(away, 'and a different one to be scoped away from').toBeTruthy();

    await seed(home);
    sentMail.length = 0;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /* ── The writer ───────────────────────────────────────────────────────────── */

  it("opens a thread carrying the customer's own account, waiting on staff", async () => {
    const reference = await openAsCustomer();
    const thread = await threadOf(reference);

    expect(thread?.customer_profile_id).toBe(customerProfileId);
    /* Exactly one subject: the CHECK forbids a second, and a booking thread is a different thing. */
    expect(thread?.booking_id).toBeNull();
    expect(thread?.partner_id).toBeNull();
    /* Somebody is waiting — this is what the الرسائل badge counts. */
    expect(thread?.unread_for_staff).toBe(1);
    expect(thread?.sender_kind).toBe('customer');
    expect(thread?.body).toContain(TITLE);
    expect(thread?.body).toContain(ACCOUNT);
  });

  /**
   * A staff member taking a complaint down over the phone has just read what they typed. A thread
   * that arrives unread to its own author inflates the queue badge with staff's own work.
   */
  it('opens one on the staff route too, and does not count it as waiting', async () => {
    const created = await staffDisputes.openForBooking(agent(), {
      bookingReference,
      kind: 'complaint',
      title: TITLE,
      description: ACCOUNT,
    });

    const thread = await threadOf(created.reference);

    expect(thread?.sender_kind).toBe('staff');
    expect(thread?.unread_for_staff).toBe(0);
    expect(thread?.body).toContain(ACCOUNT);
  });

  /** The console's own row carries it, or النزاعات and الرسائل stay two unconnected screens. */
  it('shows the thread on the dispute it belongs to', async () => {
    const reference = await openAsCustomer();
    const listed = await staffDisputes.list({ limit: 25, page: 1, q: reference });

    expect(listed.items[0]?.conversationReference).toBe(
      (await threadOf(reference))?.reference,
    );
  });

  /* ── The customer can read it, and is told when it is answered ────────────── */

  /**
   * Staff replying into a thread the customer cannot open would be a notice pointing at a page
   * that does not list it. الدعم is where they already read their correspondence.
   */
  it('lists the thread for the customer, and lets them answer in it', async () => {
    const reference = await openAsCustomer();
    const conversation = (await threadOf(reference))?.reference ?? '';

    const seen = await support.thread(customer(), conversation);

    expect(seen.messages).toHaveLength(1);

    await support.reply(customer(), conversation, 'حدث ذلك في الليلة الثانية أيضاً.');

    expect((await support.thread(customer(), conversation)).messages).toHaveLength(2);
  });

  /**
   * The clause this widening REMOVED was a shape restriction, never the authorization: that is
   * `customer_profile_id = me`, and it has to be asserted rather than believed. A dispute thread is
   * a complaint about a stay, so a reference that leaked one would read as somebody else's night.
   * `CNV-` references are sequential, so finding one is a loop rather than a guess.
   */
  it('refuses the thread to a customer it does not name', async () => {
    const reference = await openAsCustomer();
    const conversation = (await threadOf(reference))?.reference ?? '';

    await expect(support.thread(stranger(), conversation)).rejects.toMatchObject({
      response: { code: ERROR.SUPPORT_TICKET_NOT_FOUND },
    });

    await expect(
      support.reply(stranger(), conversation, 'من أنا؟'),
    ).rejects.toMatchObject({ response: { code: ERROR.SUPPORT_TICKET_NOT_FOUND } });

    /* The control: the customer it does name reads it. */
    await expect(support.thread(customer(), conversation)).resolves.toMatchObject({
      reference: conversation,
    });
  });

  /**
   * The host is structurally not in a dispute thread, and it has to stay that way.
   *
   * `conversations_exactly_one_subject_v2` forbids `dispute_id` beside `partner_id`, which is what
   * keeps them out — but on 2026-08-29 the partner's own predicate learnt to reach a thread THROUGH
   * its booking, and a dispute is about a booking. It reaches it through `c.booking_id`, which a
   * dispute thread does not carry, so the two do not meet. Asserted rather than reasoned about: a
   * complainant's account of the night is the last thing the person complained about should read
   * live, and the next widening of that predicate is where it would go wrong.
   */
  it('keeps the dispute thread away from the host it is about', async () => {
    const reference = await openAsCustomer();
    const conversation = (await threadOf(reference))?.reference ?? '';

    await expect(support.thread(accused(), conversation)).rejects.toMatchObject({
      response: { code: ERROR.SUPPORT_TICKET_NOT_FOUND },
    });

    /* The control: the customer whose complaint it is still reads it. */
    await expect(support.thread(customer(), conversation)).resolves.toMatchObject({
      reference: conversation,
    });
  });

  it('emails the customer when staff answer on it', async () => {
    const reference = await openAsCustomer();
    const conversation = (await threadOf(reference))?.reference ?? '';

    await messaging.reply(agent(), conversation, {
      body: 'سنراجع الصور المنشورة ونعود إليك.',
      internal: false,
    });

    const row = await db.execute<{ customer_profile_id: string | null }>(sql`
      SELECT customer_profile_id FROM notifications
      WHERE template_key = 'support.replied'
        AND customer_profile_id = ${customerProfileId}::uuid
      LIMIT 1
    `);

    expect(row.rows[0]?.customer_profile_id).toBe(customerProfileId);
    expect(sentMail[0]?.text).toContain(
      `http://localhost:3000/ar/account/support/${conversation}`,
    );
  });

  /* ── The city it belongs to ───────────────────────────────────────────────── */

  it('hides the thread from an operator in another city, and shows it in its own', async () => {
    const reference = await openAsCustomer();
    const conversation = (await threadOf(reference))?.reference ?? '';

    const theirs = await messaging.thread(conversation, scopedTo(away));

    expect(theirs.messages).toHaveLength(0);

    /* The control: the same call, from the city the disputed property is in. */
    const ours = await messaging.thread(conversation, scopedTo(home));

    expect(ours.messages).toHaveLength(1);
  });

  it('keeps it out of another city operator’s inbox, and in its own', async () => {
    const reference = await openAsCustomer();
    const conversation = (await threadOf(reference))?.reference ?? '';

    const theirs = await messaging.conversations({
      limit: 25,
      page: 1,
      q: conversation,
      actor: scopedTo(away),
    });

    expect(theirs.items).toHaveLength(0);

    const ours = await messaging.conversations({
      limit: 25,
      page: 1,
      q: conversation,
      actor: scopedTo(home),
    });

    expect(ours.items[0]?.subjectKind).toBe('dispute');
    /* The DISPUTE's reference, which is the point of the subject join. */
    expect(ours.items[0]?.subjectReference).toBe(reference);
  });

  it('refuses a reply and a close from another city, and allows both in its own', async () => {
    const reference = await openAsCustomer();
    const conversation = (await threadOf(reference))?.reference ?? '';

    await expect(
      messaging.reply(scopedTo(away), conversation, { body: 'لا.', internal: false }),
    ).rejects.toMatchObject({
      response: { code: ERROR.CONVERSATION_NOT_FOUND_OR_CLOSED },
    });

    await expect(messaging.close(scopedTo(away), conversation)).rejects.toMatchObject({
      response: { code: ERROR.CONVERSATION_NOT_FOUND_OR_CLOSED },
    });

    /* The control: the operator whose city it is can do both. */
    await messaging.reply(scopedTo(home), conversation, {
      body: 'نتحقق من الصور.',
      internal: false,
    });

    await expect(messaging.close(scopedTo(home), conversation)).resolves.toEqual({
      closed: true,
    });
  });

  /**
   * `read_only` widens READS across the country and never writes outside its cities. The two modes
   * are owed different answers: absence for `none`, a refusal for `read_only`.
   */
  it('lets a read-only operator read it from elsewhere and refuses the write', async () => {
    const reference = await openAsCustomer();
    const conversation = (await threadOf(reference))?.reference ?? '';

    const seen = await messaging.thread(conversation, readOnlyOutside(away));

    expect(seen.messages).toHaveLength(1);

    await expect(
      messaging.close(readOnlyOutside(away), conversation),
    ).rejects.toMatchObject({ response: { code: ERROR.SCOPE_OUTSIDE } });
  });

  /** One badge, one city. A case in Aleppo is not work waiting on a Damascus operator. */
  it('counts the thread for its own city only', async () => {
    /*
      A DELTA, not a total.

      The testbed carries threads of its own and this suite runs inside one transaction over it, so
      an exact count measures the fixture rather than the change — and would break for a reason with
      no relationship to whatever tripped it.
    */
    const before = {
      home: (await reviews.attentionCounts(scopedTo(home)))['messages_unread'] ?? 0,
      away: (await reviews.attentionCounts(scopedTo(away)))['messages_unread'] ?? 0,
    };

    await openAsCustomer();

    const after = {
      home: (await reviews.attentionCounts(scopedTo(home)))['messages_unread'] ?? 0,
      away: (await reviews.attentionCounts(scopedTo(away)))['messages_unread'] ?? 0,
    };

    expect(after.home - before.home).toBe(1);
    expect(after.away - before.away).toBe(0);
  });

  async function seed(cityId: string | null): Promise<void> {
    const made = await db.execute<{
      booking_reference: string;
      customer_profile_id: string;
      customer_user_id: string;
      stranger_profile_id: string;
      stranger_user_id: string;
      partner_id: string;
      partner_user_id: string;
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
        VALUES ('مدير العمليات', 'dth-s-' || gen_random_uuid() || '@safra.test',
                '+963900000091', 'operations_manager', 'active', 'ar')
        RETURNING id
      ), cu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('dth-c-' || gen_random_uuid() || '@safra.test', '+963900000092',
                'customer', 'active', 'ar')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('dth-p-' || gen_random_uuid() || '@safra.test', '+963900000093',
                'partner', 'active', 'ar')
        RETURNING id
      ), xu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('dth-x-' || gen_random_uuid() || '@safra.test', '+963900000094',
                'customer', 'active', 'ar')
        RETURNING id
      ), xp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest,
                                       preferred_locale)
        SELECT xu.id, 'نزيل آخر', 'dth-x-' || gen_random_uuid() || '@safra.test',
               '+963900000094', false, 'ar'
        FROM xu RETURNING id, user_id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest,
                                       preferred_locale)
        SELECT cu.id, 'نزيل النزاع', 'dth-c-' || gen_random_uuid() || '@safra.test',
               '+963900000092', false, 'ar'
        FROM cu RETURNING id, user_id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Dispute Thread', 'شريك النزاع', ref.city_id, 'x',
               '+963900000093', 'dth-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, user_id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'dispute-thread-' || gen_random_uuid(), 'عقار', 'Property', 'Property', 'x',
               'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 2, '100.00', ref.currency_id FROM pr, ref
        RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at, checked_in_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 500, current_date + 503, 2, 'checked_in'::booking_status,
               now(), now(),
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref
        RETURNING reference
      )
      SELECT bk.reference AS booking_reference,
             cp.id AS customer_profile_id, cp.user_id AS customer_user_id,
             xp.id AS stranger_profile_id, xp.user_id AS stranger_user_id,
             pa.id AS partner_id, pa.user_id AS partner_user_id,
             st.id AS staff_user_id
      FROM bk, cp, xp, pa, st
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    bookingReference = row.booking_reference;
    customerProfileId = row.customer_profile_id;
    customerUserId = row.customer_user_id;
    strangerProfileId = row.stranger_profile_id;
    strangerUserId = row.stranger_user_id;
    partnerId = row.partner_id;
    partnerUserId = row.partner_user_id;
    staffUserId = row.staff_user_id;
  }
});
