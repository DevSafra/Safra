import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@safra/db';
import { PERMISSIONS as P } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { ReviewService } from './review.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Guest reviews against a REAL PostgreSQL (design handoff §7.3, P-006).
 *
 * ## Why these are integration tests
 *
 * Almost everything that matters here is enforced by the DATABASE: P-006's refusal to delete, the
 * freeze on a review's score and text, one review per booking, and the rating aggregate that feeds
 * the search ranking. A mocked database would assert that the service called the right method,
 * which is exactly the thing that stays true while the guarantee quietly stops holding.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** The database's own refusal, unwrapped from drizzle's "Failed query: …" wrapper. */
async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const parts: string[] = [];
    let current: unknown = error;

    while (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    }

    return parts.join(' | ');
  }

  return 'NO ERROR — the statement was accepted';
}

describeIfDb('ReviewService', () => {
  const db: Database = createDatabase(DATABASE_URL ?? '', 2);
  const service = new ReviewService(db, new AuditService(db));

  let partnerId = '';
  let propertyId = '';
  let guestUserId = '';
  let partnerUserId = '';
  let staffUserId = '';
  /** A completed booking belonging to the guest, ready to be reviewed. */
  let bookingReference = '';
  /** A booking of the same guest that is NOT complete. */
  let pendingReference = '';

  const guest = (): AccessTokenClaims => ({
    sub: guestUserId,
    role: 'customer',
    permissions: [P.REVIEW_CREATE],
    locale: 'ar',
    totpEnabled: false,
  });

  /*
    A REAL user id, not an invented uuid. Every write here writes an audit row and
    `audit_log.actor_user_id` is a foreign key — a fabricated actor fails on the constraint, which
    is the audit trail refusing to record a decision nobody made.
  */
  const partner = (id = partnerId): AccessTokenClaims => ({
    sub: partnerUserId,
    role: 'partner',
    permissions: [P.REVIEW_READ_OWN, P.REVIEW_RESPOND_OWN],
    locale: 'ar',
    totpEnabled: true,
    partnerId: id,
  });

  const staff = (): AccessTokenClaims => ({
    sub: staffUserId,
    role: 'operations_manager',
    permissions: [P.REVIEW_MODERATE],
    locale: 'ar',
    totpEnabled: true,
  });

  /** Each test owns its partner, property, guest and bookings. */
  beforeEach(async () => {
    const made = await db.execute<{
      partner_id: string;
      property_id: string;
      guest_user_id: string;
      partner_user_id: string;
      done_reference: string;
      pending_reference: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD') AS currency_id,
               (SELECT id FROM property_types LIMIT 1) AS type_id,
               (SELECT id FROM partner_types LIMIT 1) AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1) AS policy_id
      ), pu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('rev-partner-' || gen_random_uuid() || '@safra.test', '+963900000000',
                'partner', 'active', 'ar')
        RETURNING id
      ), gu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('rev-guest-' || gen_random_uuid() || '@safra.test', '+963900000001',
                'customer', 'active', 'ar')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Review Test', 'Review Test', ref.city_id,
               'x', '+963900000000', 'rev@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'rev-test-' || gen_random_uuid(), 'اختبار', 'Test', 'Test', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Unit', 2, '100.00', ref.currency_id
        FROM pr, ref RETURNING id, property_id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT gu.id, 'Review Guest', 'rev-guest-' || gen_random_uuid() || '@safra.test',
               '+963900000001', false
        FROM gu RETURNING id
      ), b AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, pa.city_id,
               (current_date - (10 * n)::int)::date,
               (current_date - (10 * n)::int + 2)::date,
               2,
               (CASE WHEN n = 1 THEN 'completed' ELSE 'pending_confirmation' END)::booking_status,
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '12500.00000000', '2524875.00', '{"code":"flex"}'::jsonb
        FROM generate_series(1, 2) AS n, cp, un, pr, pa, ref
        RETURNING reference, status
      )
      SELECT pr.partner_id, pr.id AS property_id, gu.id AS guest_user_id,
             pu.id AS partner_user_id,
             (SELECT reference FROM b WHERE status = 'completed') AS done_reference,
             (SELECT reference FROM b WHERE status = 'pending_confirmation')
               AS pending_reference
      FROM pr, gu, pu
    `);

    const row = made.rows[0];

    partnerId = row?.partner_id ?? '';
    propertyId = row?.property_id ?? '';
    guestUserId = row?.guest_user_id ?? '';
    partnerUserId = row?.partner_user_id ?? '';
    bookingReference = row?.done_reference ?? '';
    pendingReference = row?.pending_reference ?? '';

    const s = await db.execute<{ id: string }>(sql`
      SELECT id FROM users
      WHERE role IN ('operations_manager', 'super_admin') AND deleted_at IS NULL
      ORDER BY created_at LIMIT 1
    `);
    staffUserId = s.rows[0]?.id ?? '';
  });

  afterAll(async () => {
    await db.$client.end();
  });

  async function write(rating = 5, body = 'إقامة ممتازة وضيافة راقية.') {
    return service.create(guest(), { bookingReference, rating, body });
  }

  describe('writing one', () => {
    it('accepts a review of a completed stay from the guest who stayed', async () => {
      const result = await write(5);

      expect(result.reference).toMatch(/^REV-\d{6}$/);
      expect(result.rating).toBe(5);
    });

    /*
      The three checks that stand between a request and a ranking change. `properties.rating` is
      the heaviest input to the search score, so each of these is a ranking exploit, not a
      rudeness.
    */
    it('refuses a stay that has not finished', async () => {
      await expect(
        service.create(guest(), {
          bookingReference: pendingReference,
          rating: 5,
          body: 'not yet',
        }),
      ).rejects.toThrow();
    });

    it("refuses somebody else's booking", async () => {
      const stranger: AccessTokenClaims = {
        ...guest(),
        sub: '00000000-0000-0000-0000-000000000009',
      };

      await expect(
        service.create(stranger, { bookingReference, rating: 5, body: 'never stayed' }),
      ).rejects.toThrow();
    });

    it('refuses a second review of the same stay', async () => {
      await write();

      await expect(write(1, 'changed my mind')).rejects.toThrow();
    });

    /*
      Even when the service check is bypassed. The unique index is the real control — a
      service-level "already reviewed?" races with a concurrent request and an index does not.
    */
    it('refuses a duplicate at the DATABASE, not only in the service', async () => {
      await write();

      const message = await refusal(
        db.execute(sql`
          INSERT INTO reviews (booking_id, property_id, unit_id, partner_id,
                               customer_profile_id, rating, body)
          SELECT r.booking_id, r.property_id, r.unit_id, r.partner_id,
                 r.customer_profile_id, 1, 'second'
          FROM reviews r
          JOIN bookings b ON b.id = r.booking_id
          WHERE b.reference = ${bookingReference}
        `),
      );

      expect(message).toMatch(/reviews_booking_unique/i);
    });

    it('refuses a caller without the permission', async () => {
      const unarmed = { ...guest(), permissions: [] };

      await expect(
        service.create(unarmed, { bookingReference, rating: 5, body: 'no rights' }),
      ).rejects.toThrow();
    });
  });

  /**
   * What the customer app asks before it draws a form.
   *
   * The prompt and the write endpoint have to agree about eligibility, or a customer is offered a
   * form that then refuses them — so these assert the two answer the same question.
   */
  describe('customer eligibility', () => {
    it('offers a completed, unreviewed stay', async () => {
      const pending = await service.pendingForCustomer(guest());

      expect(pending.map((row) => row.bookingReference)).toContain(bookingReference);
    });

    it('stops offering it once it has been reviewed', async () => {
      await write();

      const pending = await service.pendingForCustomer(guest());

      expect(pending.map((row) => row.bookingReference)).not.toContain(bookingReference);
    });

    it('never offers a stay that has not finished', async () => {
      const pending = await service.pendingForCustomer(guest());

      expect(pending.map((row) => row.bookingReference)).not.toContain(pendingReference);
    });

    it('offers a different customer nothing of this one’s', async () => {
      const stranger: AccessTokenClaims = {
        ...guest(),
        sub: staffUserId,
      };

      const pending = await service.pendingForCustomer(stranger);

      expect(pending.map((row) => row.bookingReference)).not.toContain(bookingReference);
    });

    it('reports a completed stay as eligible, with the property named', async () => {
      const view = await service.forBooking(guest(), bookingReference);

      expect(view.eligible).toBe(true);
      expect(view.stayCompleted).toBe(true);
      expect(view.alreadyReviewed).toBe(false);
      expect(view.propertyName).toBe('اختبار');
    });

    it('reports an unfinished stay as not yet eligible', async () => {
      const view = await service.forBooking(guest(), pendingReference);

      expect(view.eligible).toBe(false);
      expect(view.stayCompleted).toBe(false);
    });

    it('returns the review once written, so the page shows it instead of a form', async () => {
      await write(4, 'كانت إقامة هادئة ومريحة.');

      const view = await service.forBooking(guest(), bookingReference);

      expect(view.eligible).toBe(false);
      expect(view.alreadyReviewed).toBe(true);
      expect(view.review?.rating).toBe(4);
    });

    /*
      Hiding a review from its own author would leave them unable to tell "SAFRA removed this"
      from "it never saved" — and the second reading produces a duplicate attempt that the unique
      index then refuses, which reads as the site being broken.
    */
    it('still shows the author their own review after staff hide it', async () => {
      const { reference } = await write();
      await service.report(partner(), reference, 'Describes a different property.');
      await service.moderate(staff(), reference, {
        decision: 'uphold',
        note: 'Upheld after review.',
      });

      const view = await service.forBooking(guest(), bookingReference);

      expect(view.review?.status).toBe('hidden');
      expect(view.review?.body).toBeTruthy();
    });

    /*
      A booking that is not yours is a 404, indistinguishable from one that does not exist. A
      different answer would let a reference be probed, and references are sequential (§13.2).
    */
    it('answers not-found for a booking belonging to somebody else', async () => {
      const stranger: AccessTokenClaims = { ...guest(), sub: staffUserId };

      await expect(service.forBooking(stranger, bookingReference)).rejects.toThrow();
    });

    it('answers not-found for a reference that does not exist', async () => {
      await expect(service.forBooking(guest(), 'BKG-2026-999999')).rejects.toThrow();
    });
  });

  /**
   * P-006, asserted where it actually lives.
   *
   * *"لا يمكن حذف تقييم — يمكنك الرد عليه أو الإبلاغ عنه"*. The service has no delete method, but
   * these prove the rule survives anything that goes around the service.
   */
  describe('P-006 — a review cannot be deleted or rewritten', () => {
    it('refuses a DELETE outright', async () => {
      const { reference } = await write();

      const message = await refusal(
        db.execute(sql`DELETE FROM reviews WHERE reference = ${reference}`),
      );

      expect(message).toMatch(/cannot be deleted/i);
    });

    it('refuses an edit to the body', async () => {
      const { reference } = await write();

      const message = await refusal(
        db.execute(
          sql`UPDATE reviews SET body = 'rewritten' WHERE reference = ${reference}`,
        ),
      );

      expect(message).toMatch(/cannot be changed/i);
    });

    it('refuses an edit to the score', async () => {
      const { reference } = await write(5);

      const message = await refusal(
        db.execute(sql`UPDATE reviews SET rating = 1 WHERE reference = ${reference}`),
      );

      expect(message).toMatch(/cannot be changed/i);
    });

    it('still allows the two remedies the rule promises', async () => {
      const { reference } = await write();

      await expect(
        service.reply(partner(), reference, 'شكرًا لك على إقامتك معنا.'),
      ).resolves.toEqual({ replied: true });

      await expect(
        service.report(partner(), reference, 'The guest describes a different property.'),
      ).resolves.toEqual({ reported: true });
    });
  });

  describe('the partner’s view', () => {
    it('lists their own reviews with the §7.3 header figures', async () => {
      await write(4);

      const page = await service.listForPartner(partner(), { page: 1, limit: 25 });

      expect(page.items).toHaveLength(1);
      expect(page.summary.average).toBe('4.0');
      expect(page.summary.published).toBe(1);
    });

    /* §7.2: a partner is shown no customer contact details. A review screen is where that slips. */
    it('carries the guest’s name and nothing else about them', async () => {
      await write();

      const page = await service.listForPartner(partner(), { page: 1, limit: 25 });
      const blob = JSON.stringify(page.items[0]);

      expect(page.items[0]?.guestName).toBe('Review Guest');
      expect(blob).not.toMatch(/@safra\.test/);
      expect(blob).not.toMatch(/\+9639/);
    });

    it('shows a neighbouring partner nothing', async () => {
      await write();

      const page = await service.listForPartner(
        { ...partner(), partnerId: '00000000-0000-0000-0000-00000000000f' },
        { page: 1, limit: 25 },
      );

      expect(page.items).toHaveLength(0);
    });

    it('refuses a reply to a review belonging to another partner', async () => {
      const { reference } = await write();

      await expect(
        service.reply(
          { ...partner(), partnerId: '00000000-0000-0000-0000-00000000000f' },
          reference,
          'not mine',
        ),
      ).rejects.toThrow();
    });

    it('allows one reply and refuses a second', async () => {
      const { reference } = await write();

      await service.reply(partner(), reference, 'شكرًا لك.');

      await expect(service.reply(partner(), reference, 'مرة أخرى')).rejects.toThrow();
    });

    /*
      THE rule that keeps reporting honest. If reporting hid a review, every partner would report
      everything below four stars and the ★ average would mean nothing.
    */
    it('does not hide a review when the partner reports it', async () => {
      const { reference } = await write(1, 'المكان لم يكن كما وُصف.');

      await service.report(partner(), reference, 'This describes a different property.');

      const row = await db.execute<{ status: string }>(
        sql`SELECT status::text FROM reviews WHERE reference = ${reference}`,
      );

      expect(row.rows[0]?.status).toBe('published');
    });

    it('refuses a second report of the same review', async () => {
      const { reference } = await write();

      await service.report(partner(), reference, 'First report, with enough detail.');

      await expect(
        service.report(partner(), reference, 'Second report, with enough detail.'),
      ).rejects.toThrow();
    });
  });

  describe('staff moderation', () => {
    /*
      The queue is GLOBAL — it is every partner's reports, oldest first, because staff work a
      backlog from the front. So a newly reported review lands at the END, and on a database with
      a backlog it is not on page one.

      Asserted on the TOTAL rather than by hunting for the reference on an arbitrary page. That is
      also the honest assertion: what matters is that reporting puts something in the queue, and
      which page it lands on is a property of how much work is already waiting.
    */
    it('puts a reported review into the staff queue', async () => {
      const before = (await service.listReported({ page: 1, limit: 1 })).total;

      const { reference } = await write();
      await service.report(partner(), reference, 'Describes a different property.');

      const after = await service.listReported({ page: 1, limit: 1 });

      expect(after.total).toBe(before + 1);
    });

    /* And it is reachable — on whichever page the backlog puts it. */
    it('is findable in the queue by walking it', async () => {
      const { reference } = await write();
      await service.report(partner(), reference, 'Describes a different property.');

      const { total } = await service.listReported({ page: 1, limit: 1 });
      const all = await service.listReported({ page: 1, limit: Math.min(total, 100) });

      /* Newest is last: oldest-first ordering, so the one just added is at the back. */
      expect(all.items.at(-1)?.reference).toBe(reference);
    });

    it('hides a review when a report is upheld, with an actor and a note', async () => {
      const { reference } = await write();
      await service.report(partner(), reference, 'Describes a different property.');

      await service.moderate(staff(), reference, {
        decision: 'uphold',
        note: 'Confirmed: the guest reviewed the wrong listing.',
      });

      const row = await db.execute<{
        status: string;
        moderated_by: string | null;
        note: string | null;
      }>(sql`
        SELECT status::text, moderated_by_user_id AS moderated_by, moderation_note AS note
        FROM reviews WHERE reference = ${reference}
      `);

      expect(row.rows[0]?.status).toBe('hidden');
      expect(row.rows[0]?.moderated_by).toBe(staffUserId);
      expect(row.rows[0]?.note).toContain('wrong listing');
    });

    it('leaves a review published when a report is dismissed', async () => {
      const { reference } = await write();
      await service.report(partner(), reference, 'Describes a different property.');

      await service.moderate(staff(), reference, {
        decision: 'dismiss',
        note: 'Read it; it is about this listing and is within the rules.',
      });

      const row = await db.execute<{ status: string }>(
        sql`SELECT status::text FROM reviews WHERE reference = ${reference}`,
      );

      expect(row.rows[0]?.status).toBe('published');
    });

    it('refuses to moderate a review nobody reported', async () => {
      const { reference } = await write();

      await expect(
        service.moderate(staff(), reference, { decision: 'uphold', note: 'no report' }),
      ).rejects.toThrow();
    });

    /* Hiding is moderation. The row survives, which is the whole distinction P-006 draws. */
    it('keeps the row after hiding it', async () => {
      const { reference } = await write();
      await service.report(partner(), reference, 'Describes a different property.');
      await service.moderate(staff(), reference, {
        decision: 'uphold',
        note: 'Upheld after review.',
      });

      const row = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM reviews WHERE reference = ${reference}`,
      );

      expect(row.rows[0]?.n).toBe(1);
    });
  });

  /**
   * The rating aggregate — the number that decides search position.
   *
   * Maintained by a trigger rather than by application code, so it cannot drift when a code path
   * forgets. These assert it in both directions, because the direction that matters most is the
   * one nobody tests: a hidden review must stop counting immediately, or a review SAFRA removed
   * from the page carries on working on the ranking.
   */
  describe('the property rating', () => {
    async function propertyRating() {
      const row = await db.execute<{ rating: string | null; n: number }>(
        sql`SELECT rating::text, reviews_count AS n FROM properties WHERE id = ${propertyId}`,
      );

      return row.rows[0];
    }

    it('rises to the review that was written', async () => {
      await write(4);

      expect(await propertyRating()).toMatchObject({ rating: '4.0', n: 1 });
    });

    it('drops the review the moment staff hide it', async () => {
      const { reference } = await write(4);
      await service.report(partner(), reference, 'Describes a different property.');
      await service.moderate(staff(), reference, {
        decision: 'uphold',
        note: 'Upheld after review.',
      });

      expect(await propertyRating()).toMatchObject({ rating: null, n: 0 });
    });

    it('is unaffected by a report on its own', async () => {
      const { reference } = await write(4);
      await service.report(partner(), reference, 'Describes a different property.');

      expect(await propertyRating()).toMatchObject({ rating: '4.0', n: 1 });
    });
  });
});
