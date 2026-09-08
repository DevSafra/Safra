import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR, PERMISSIONS as P } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PayoutService } from '../payouts/payout.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PartnerDisputesService } from './partner-disputes.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * The partner's side of a dispute — what they may read, and what must never reach them.
 *
 * ## What is worth asserting here
 *
 * Not that the screen renders. That a READER gets exactly what Bashar's boundary allows
 * (2026-09-08) and nothing else, per permission, and that the wall is a `WHERE` rather than a
 * decision the portal makes about which fields to draw.
 *
 * The privacy assertions are phrased GENERALLY — every string in the payload is walked and
 * compared against the guest's contact details — because `not.toContain(email)` only ever protects
 * the string it names. This codebase has already shipped that mistake: an assertion that no audit
 * payload carried an email address stayed green when a full name started shipping beside it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** Long enough for the schema's minimum, and recognisable in an assertion. */
const ACCOUNT =
  'The guest was given the unit they booked and the photographs on the listing are this year’s.';

describeIfDb('a dispute, from the partner’s side', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const service = new PartnerDisputesService(db, new AuditService(db));

  /*
    The real payout service, for the one assertion that crosses into مستحقاتي.

    Its `withheldForPartner` is a read, so the ledger and settings collaborators are never reached —
    but they are the real classes rather than stubs, because a stub is a claim about which methods a
    read touches and that claim goes stale exactly the way five notifier stubs did on 2026-09-08.
  */
  const payouts = new PayoutService(
    db,
    new AuditService(db),
    new LedgerService(db),
    new SettingsService(db),
  );

  let reference = '';
  let disputeId = '';
  let partnerId = '';
  let partnerUserId = '';
  let otherPartnerId = '';
  let customerUserId = '';
  let staffId = '';
  let guestEmail = '';
  let guestPhone = '';

  /** The owner: may read the money as well as the case. */
  const owner = (id?: string): AccessTokenClaims =>
    ({
      sub: partnerUserId,
      role: 'partner',
      partnerId: id ?? partnerId,
      permissions: [P.DISPUTE_RESPOND_OWN, P.PAYOUT_READ_OWN],
    }) as unknown as AccessTokenClaims;

  /**
   * An EMPLOYEE holding the dispute permission and not the payout one.
   *
   * The account of the night is the business's to give; the money is the owner's. The same split
   * the dashboard already makes for earnings.
   */
  const employee = (): AccessTokenClaims =>
    ({
      sub: partnerUserId,
      role: 'partner_employee',
      partnerId,
      permissions: [P.DISPUTE_RESPOND_OWN],
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();

    const made = await db.execute<{
      id: string;
      reference: string;
      partner_id: string;
      partner_user: string;
      other_partner: string;
      customer_user: string;
      staff: string;
      guest_email: string;
      guest_phone: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL ORDER BY id LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')                       AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                              AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                               AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)                       AS policy_id
      ), st AS (
        INSERT INTO users (email, phone, role, status)
        VALUES (${`pd-s-${randomUUID()}@safra.test`}, '+963900000180', 'super_admin', 'active')
        RETURNING id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES (${`pd-c-${randomUUID()}@safra.test`}, '+963900000181', 'customer', 'active')
        RETURNING id, email
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'مريم الحسيني', cu.email, '+963900000181', false FROM cu
        RETURNING id, email, phone, full_name
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES (${`pd-p-${randomUUID()}@safra.test`}, '+963900000182', 'partner', 'active')
        RETURNING id, email
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Partner Disputes', 'شريك النزاعات', ref.city_id, 'x',
               '+963900000182', pu.email, 'approved'
        FROM pu, ref RETURNING id
      ), pu2 AS (
        INSERT INTO users (email, phone, role, status)
        VALUES (${`pd-p2-${randomUUID()}@safra.test`}, '+963900000183', 'partner', 'active')
        RETURNING id, email
      ), pa2 AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu2.id, ref.partner_type_id, 'Somebody Else', 'شريك آخر', ref.city_id, 'x',
               '+963900000183', pu2.email, 'approved'
        FROM pu2, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               ${`pd-${randomUUID()}`}, 'عقار', 'Property', 'Objekt', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'الوحدة الثانية', 'Unit', 'Einheit', 4, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot, paid_at,
                              -- A stay that FINISHED and was then disputed, which is the case the
                              -- frozen-funds panel exists for. With no completed_at this is a
                              -- future stay whose payable is not yet earned, and HELD_BY_DISPUTE
                              -- is right not to list it. (No backticks: they end this template.)
                              completed_at)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date - 6, current_date - 4, 2, 'disputed'::booking_status,
               '100.00', '9.00', '9.00', '0.0700', '7.00', '109.00', '93.00',
               ref.currency_id, '13000.00000000', '1417000.00', '{"code":"flex"}'::jsonb, now(),
               now() - interval '4 days'
        FROM cp, un, pr, ref RETURNING id
      ), bu AS (
        INSERT INTO booking_units (booking_id, unit_id, check_in, check_out, status,
                                   accommodation_amount)
        SELECT bk.id, un.id, current_date - 6, current_date - 4, 'disputed', '100.00'
        FROM bk, un
        ON CONFLICT (booking_id, unit_id) DO NOTHING
        RETURNING booking_id
      )
      INSERT INTO disputes (booking_id, partner_id, customer_profile_id, kind, status,
                            title, description)
      SELECT bk.id, pr.partner_id, cp.id, 'not_as_described', 'open',
             'الغرفة لا تطابق الصور المنشورة',
             'الوحدة تطل على المرآب لا الحديقة، والصور على الإعلان لغرفة أخرى.'
      FROM bk, pr, cp
      RETURNING id, reference,
                (SELECT id::text FROM pa)   AS partner_id,
                (SELECT id::text FROM pu)   AS partner_user,
                (SELECT id::text FROM pa2)  AS other_partner,
                (SELECT id::text FROM cu)   AS customer_user,
                (SELECT id::text FROM st)   AS staff,
                (SELECT email FROM cp)      AS guest_email,
                (SELECT phone FROM cp)      AS guest_phone
    `);

    const row = made.rows[0];

    if (!row) throw new Error('the partner-dispute fixture built no dispute');

    disputeId = row.id;
    reference = row.reference;
    partnerId = row.partner_id;
    partnerUserId = row.partner_user;
    otherPartnerId = row.other_partner;
    customerUserId = row.customer_user;
    staffId = row.staff;
    guestEmail = row.guest_email;
    guestPhone = row.guest_phone;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /** Every string anywhere in a payload, however deeply nested. */
  const strings = (value: unknown): string[] => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap((one) => strings(one));
    if (value !== null && typeof value === 'object') {
      return Object.values(value).flatMap((one) => strings(one));
    }

    return [];
  };

  /**
   * The allegation reaches the partner, because there is nothing to answer without it.
   *
   * Bashar's list: the reference, the category, the status, the guest's title AND description, the
   * booking, and the frozen amount. The description is the half that decides these — «الغرفة لم
   * تطابق الوصف» is the headline; that the unit faced the garage is the complaint.
   */
  it('gives the partner the allegation, the booking and the money at stake', async () => {
    const view = await service.detail(reference, owner());

    expect(view.reference).toBe(reference);
    expect(view.status).toBe('open');
    expect(view.kind).toBe('not_as_described');
    expect(view.title).toContain('الصور المنشورة');
    expect(view.description, 'the account, not only the headline').toContain('المرآب');
    expect(view.booking.reference).toMatch(/^BKG-/);
    expect(view.booking.unitName, 'which unit it was about').toBe('الوحدة الثانية');
    /*
      Compared as a NUMBER, not as a string.

      `partner_payable_amount` is `numeric(14,3)` and pg renders a numeric at the COLUMN's own
      scale, so this arrives as «93.000». A two-decimal literal here would have failed for a reason
      that has nothing to do with the money being right — and the same mistake in production code
      once described every refund as «0.00 USD إلى المحفظة» because `=== '0.00'` never matched
      pg's «0.000».
    */
    expect(Number(view.frozenAmount), 'their own money, held').toBe(93);
    expect(view.currencyCode, 'and never an amount without one').toBe('USD');
    expect(view.resolution, 'undecided while it is open').toBeNull();
  });

  /**
   * The four things Bashar named as private, asked GENERALLY.
   *
   * *«Do not expose customer contact information. Do not expose customer payment or wallet
   * information. Do not expose internal staff notes.»* Every string in the payload is walked, so a
   * field added later that happens to carry the guest's address fails this without anybody
   * remembering to name it — which is the failure mode a `not.toContain(email)` walks straight
   * around.
   */
  it('carries no contact detail, no name and no internal note of the guest’s', async () => {
    const view = await service.detail(reference, owner());
    const all = strings(view);

    for (const secret of [guestEmail, guestPhone, 'مريم الحسيني']) {
      expect(
        all.filter((one) => one.includes(secret)),
        `the guest’s ${secret} must not be in the partner’s payload`,
      ).toStrictEqual([]);
    }

    /* And the control: the payload is not simply empty, so the walk had something to inspect. */
    expect(all.length, 'the walk read a real payload').toBeGreaterThan(5);
  });

  /**
   * The payload's SHAPE is a written allow-list, and adding to it has to be deliberate.
   *
   * ## Why a shape assertion and not only the PII walk above
   *
   * The walk catches a field that happens to carry today's fixture values. It cannot catch a field
   * that carries something private this fixture does not set — a guest's address, their wallet
   * balance, an internal note — because there is nothing to compare against. Listing the keys
   * turns «what may the partner see» into a decision somebody makes rather than a consequence of a
   * SELECT somebody widened.
   *
   * ## And it is tied to a DISCLOSURE, which is the part that would otherwise rot
   *
   * The privacy policy tells the customer exactly what reaches the partner. On 2026-09-08 it still
   * read «your name, your stay dates, and what they need to receive you — NO MORE» while this
   * payload had started carrying the guest's own title and description; the sentence became false
   * the moment the partner got a dispute screen. `legal.privacy.shareBody` and
   * `legal.terms.disputesBody` in `messages/web/*.json` were corrected the same day.
   *
   * So a key added here means the policy needs a sentence, and this failing test is where somebody
   * finds that out. A test that only asked «is the guest's email absent» would never have said so.
   */
  it('returns only the fields the privacy policy says reach the partner', () => {
    const allowed = [
      /* The case itself. */
      'reference',
      'kind',
      'status',
      'openedAt',
      'closedAt',
      /* The guest's OWN WORDS, disclosed in `legal.privacy.shareBody`. */
      'title',
      'description',
      /* SAFRA's decision — «the reasoning that can be shared with them». */
      'resolution',
      /* Their booking, and their money. */
      'booking',
      'frozenAmount',
      'currencyCode',
      /* Their own side of it. */
      'responses',
      'evidence',
      'withheldEvidenceCount',
    ].sort();

    return service.detail(reference, owner()).then((view) => {
      expect(
        Object.keys(view).sort(),
        'A key here is a field about a guest that a host can read. Add it to this list only ' +
          'with a decision, and say so in legal.privacy.shareBody — the policy tells the ' +
          'customer what reaches the partner, and it has been wrong once already.',
      ).toStrictEqual(allowed);

      /* The nested booking object is part of the same promise, so it is listed too. */
      expect(Object.keys(view.booking).sort()).toStrictEqual(
        ['checkIn', 'checkOut', 'reference', 'unitName'].sort(),
      );
    });
  });

  /**
   * The frozen amount is withheld from an employee, and shown to the owner.
   *
   * Both halves, because «withheld» and «absent» are indistinguishable without the second: an
   * amount that never renders for anybody would satisfy the first assertion alone.
   */
  it('withholds the held amount from an employee who may not read payouts', async () => {
    const asEmployee = await service.detail(reference, employee());

    expect(asEmployee.frozenAmount, 'the money is the owner’s').toBeNull();
    expect(asEmployee.currencyCode, 'and no bare figure either').toBeNull();
    expect(asEmployee.title, 'the case itself is still readable').toContain(
      'الصور المنشورة',
    );

    const asOwner = await service.detail(reference, owner());

    expect(Number(asOwner.frozenAmount), 'and the owner does see it').toBe(93);

    const listed = await service.list(employee());

    expect(
      listed.disputes[0]?.frozenAmount,
      'the list agrees with the detail',
    ).toBeNull();
  });

  /**
   * Another partner's dispute is not there — 404, never 403.
   *
   * `DSP-` references are sequential (§13.2), so «exists and is not yours» has to be
   * indistinguishable from «does not exist» or the sequence can be walked one refusal at a time.
   */
  it('refuses another partner’s dispute as if it did not exist', async () => {
    await expect(service.detail(reference, owner(otherPartnerId))).rejects.toMatchObject({
      response: { code: ERROR.DISPUTE_NOT_FOUND },
    });

    const listed = await service.list(owner(otherPartnerId));

    expect(listed.disputes, 'and it is not in their list either').toStrictEqual([]);
  });

  /**
   * The guest's files are counted, not listed — and a released one crosses over.
   *
   * *«If staff determine that a customer image or file is necessary for a fair resolution, then
   * that should be an explicit staff decision and not the default behaviour.»* So the default is a
   * NUMBER: «there is one item you have not seen» is what lets a host ask for it, and a filename
   * can carry as much as the photograph it names.
   */
  it('counts the guest’s withheld files and lists only what the partner may open', async () => {
    await db.execute(sql`
      INSERT INTO dispute_evidence (dispute_id, kind, file_name, storage_key, content_type,
                                    size_bytes, uploaded_by_user_id)
      VALUES
        (${disputeId}::uuid, 'photo', 'the-garage-view.jpg', 'disputes/a', 'image/avif', 10, NULL),
        (${disputeId}::uuid, 'photo', 'guest-passport.jpg',  'disputes/b', 'image/avif', 10, NULL),
        (${disputeId}::uuid, 'photo', 'as-advertised.jpg',   'disputes/c', 'image/avif', 10,
         ${partnerUserId}::uuid)
    `);

    const before = await service.detail(reference, owner());

    expect(
      before.evidence.map((one) => one.fileName),
      'their own upload, and nothing of the guest’s',
    ).toStrictEqual(['as-advertised.jpg']);
    expect(before.withheldEvidenceCount, 'and the rest as a number').toBe(2);
    expect(
      strings(before).filter((one) => one.includes('passport')),
      'not even the name of a withheld file',
    ).toStrictEqual([]);

    /* An operator releases ONE of them — the room, not the passport. */
    await db.execute(sql`
      UPDATE dispute_evidence
      SET shared_with_partner = true, shared_at = now(), shared_by_user_id = ${staffId}::uuid
      WHERE dispute_id = ${disputeId}::uuid AND file_name = 'the-garage-view.jpg'
    `);

    const after = await service.detail(reference, owner());

    expect(
      after.evidence.map((one) => one.fileName).sort(),
      'the released file crosses over',
    ).toStrictEqual(['as-advertised.jpg', 'the-garage-view.jpg']);
    expect(after.withheldEvidenceCount, 'and the count falls by exactly one').toBe(1);
    expect(
      after.evidence.find((one) => one.fileName === 'as-advertised.jpg')?.mine,
      'and the partner is told which is theirs',
    ).toBe(true);
  });

  /**
   * A response is stored REDACTED, and the audit row does not repeat it.
   *
   * Same rule as every other body on the platform: a partner pasting the guest's number into their
   * account of the night must not create a copy of it. The count of removed spans travels to the
   * audit log instead of the text, because «this response had a contact detail taken out» is worth
   * knowing and a second copy of somebody's account of their night is not.
   */
  it('redacts a contact detail out of a response, and audits the count not the body', async () => {
    const result = await service.respond(
      reference,
      `${ACCOUNT} Call me on 0955123456 if you need the file.`,
      owner(),
    );

    expect(result.redactedCount, 'the number was taken out').toBeGreaterThan(0);

    const stored = await db.execute<{ body: string }>(sql`
      SELECT body FROM dispute_responses WHERE dispute_id = ${disputeId}::uuid
    `);
    const body = stored.rows[0]?.body ?? '';

    expect(body, 'and is not in the row').not.toContain('0955123456');
    expect(
      PartnerDisputesService.hasRedaction(body),
      'the reader is told something was removed',
    ).toBe(true);

    const audited = await db.execute<{ after: Record<string, unknown> }>(sql`
      SELECT after FROM audit_log
      WHERE action = 'dispute.partner_responded' AND subject_id = ${disputeId}::uuid
    `);

    expect(audited.rows[0]?.after).toStrictEqual({ reference, redactedCount: 1 });

    const view = await service.detail(reference, owner());

    expect(view.responses, 'and it appears on their own screen').toHaveLength(1);

    /*
      And مستحقاتي stops asking for it.

      The frozen-funds panel tells a partner what has to happen before the money moves, and while
      nobody has answered, the answer is «you» (finding 209). That line must disappear the moment
      they DO answer, or the screen nags for something already done — so the count behind it is
      asserted here, in the suite that writes the response, rather than in the payouts suite, where
      `dispute_responses` is append-only by trigger and the row could not be cleaned up.
    */
    const held = await payouts.withheldForPartner(owner());
    const row = held.find((one) => one.disputeReference === reference);

    expect(row, 'the held booking is on مستحقاتي').toBeDefined();
    expect(row?.responseCount, 'and the answer is counted').toBe(1);
    expect(row?.disputeKind, 'beside why it is held').toBe('not_as_described');
  });

  /**
   * A closed dispute takes no responses.
   *
   * The same rule the evidence follows and the same sentence: the resolution must stay readable
   * against what was in front of the person who wrote it. A partner who disagrees with a decision
   * has support, not a text box that silently edits the record it was made from.
   */
  it('refuses a response once the dispute has been decided', async () => {
    await db.execute(sql`
      UPDATE disputes
      SET status = 'rejected'::dispute_status, resolution = 'الصور مطابقة.', closed_at = now()
      WHERE id = ${disputeId}::uuid
    `);

    await expect(service.respond(reference, ACCOUNT, owner())).rejects.toMatchObject({
      response: { code: ERROR.DISPUTE_ALREADY_CLOSED },
    });

    /* And the DECISION is readable, which is the whole point of hearing them first. */
    const view = await service.detail(reference, owner());

    expect(view.resolution, 'the reasoning that can be shared with them').toBe(
      'الصور مطابقة.',
    );
  });

  /**
   * A reader without `dispute.respond_own` cannot reach any of it.
   *
   * The permission is checked before the partner id is resolved, so an employee who may see
   * bookings and not disputes gets a refusal rather than an empty list — an empty list would read
   * as «no complaints against you», which is a different and dangerous statement.
   */
  it('refuses a partner reader who does not hold the dispute permission', async () => {
    const without = {
      sub: partnerUserId,
      role: 'partner_employee',
      partnerId,
      permissions: [P.BOOKING_READ_OWN],
    } as unknown as AccessTokenClaims;

    await expect(service.list(without)).rejects.toBeDefined();
    await expect(service.detail(reference, without)).rejects.toBeDefined();
    await expect(service.respond(reference, ACCOUNT, without)).rejects.toBeDefined();
  });

  /** A customer's own token carries no partner, so none of this is reachable with one. */
  it('refuses a customer token outright', async () => {
    const asCustomer = {
      sub: customerUserId,
      role: 'customer',
      permissions: [P.DISPUTE_RESPOND_OWN],
    } as unknown as AccessTokenClaims;

    await expect(service.detail(reference, asCustomer)).rejects.toBeDefined();
  });
});
