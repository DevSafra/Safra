import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  COUNT_CAP,
  ERROR,
  PERMISSIONS as P,
  type OffsetPage,
  type PageQuery,
  type CursorQuery,
  type ReviewCreateInput,
  type ReviewModerateInput,
  decodeCursor,
  encodeCursor,
  offsetPage,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { ENV, type Env } from '../config/env.js';
import { reviewReceivedMail, reviewRepliedMail } from '../mail/mail.templates.js';
import { NotificationService } from '../notifications/notification.service.js';
import { DATABASE } from '../database/database.module.js';
import { requirePartnerId } from '../rbac/ownership.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { assertCanWrite, scopeFilter } from '../rbac/scope.sql.js';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthorized,
} from '../common/errors/app-error.js';

/** A uuid, checked before it reaches a `::uuid` cast so a forged cursor is a 400 and not a 500. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guest reviews (design handoff §7.3, P-006).
 *
 * ## P-006, and where it is actually enforced
 *
 * *"لا يمكن حذف تقييم — يمكنك الرد عليه أو الإبلاغ عنه"*. This service has no delete method, but
 * that is not what makes the rule hold: a trigger refuses `DELETE` on the table and a second one
 * freezes `rating` and `body` after insert. So the rule survives a service somebody writes later,
 * a migration, and a console with direct database access. What this class does is offer the two
 * remedies the rule promises instead.
 *
 * ## Why a review needs a completed booking
 *
 * `properties.rating` is the heaviest input to the search ranking (`WEIGHTS.rating = 3.5`, "the
 * strongest signal"), so an unearned review is not rudeness, it is a ranking exploit. Three checks
 * stand between a request and a rating change, and each catches a different attack:
 *
 *  1. the booking must belong to the CALLER — otherwise anybody reviews anybody's stay;
 *  2. it must be `completed` — otherwise a booking made this morning rates a listing tonight;
 *  3. one review per booking, by unique index — otherwise a single stay votes repeatedly.
 *
 * The third is the database's, deliberately: a service-level check races with itself.
 *
 * ## Visibility
 *
 * A review is `published` on write. Holding every review for approval would make the partner's
 * ability to report one meaningless — there would be nothing to report, only a queue. Staff move
 * one to `hidden` after a report, which is a decision with an actor, a timestamp and a note, and
 * the row survives. A hidden review leaves the public average immediately, because the aggregate
 * trigger counts published rows only.
 */
@Injectable()
export class ReviewService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get partnerUrl(): string {
    return this.env.PARTNER_URL;
  }

  private get appUrl(): string {
    return this.env.APP_URL;
  }

  /**
   * A guest writing about a stay.
   *
   * Takes a booking REFERENCE and derives the property, unit and partner from it. Accepting those
   * from the client would let a five-star review of one's own listing be attached to somebody
   * else's stay — the ids would all be valid and nothing downstream would notice.
   */
  async create(claims: AccessTokenClaims | undefined, input: ReviewCreateInput) {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    if (!(claims.permissions ?? []).includes(P.REVIEW_CREATE)) {
      throw forbidden(ERROR.PERMISSION_DENIED);
    }

    const booking = await this.db.execute<{
      id: string;
      property_id: string;
      unit_id: string;
      partner_id: string;
      customer_profile_id: string;
      status: string;
      owner_user_id: string | null;
      already: string | null;
    }>(sql`
      SELECT b.id, b.property_id, b.unit_id, b.partner_id, b.customer_profile_id,
             b.status::text AS status,
             cp.user_id AS owner_user_id,
             (SELECT r.id FROM reviews r WHERE r.booking_id = b.id) AS already
      FROM bookings b
      JOIN customer_profiles cp ON cp.id = b.customer_profile_id
      WHERE b.reference = ${input.bookingReference}
    `);

    const row = booking.rows[0];

    if (!row) throw notFound(ERROR.BOOKING_NOT_FOUND);

    /*
      The booking must be the caller's OWN.

      Compared on the profile's `user_id`, not on anything in the request. A guest booking has no
      user id at all, so it fails this check — which is correct: a guest who never made an account
      cannot be authenticated as the person who stayed, and `REVIEW_CREATE` is a permission only a
      signed-in customer holds.
    */
    if (!row.owner_user_id || row.owner_user_id !== claims.sub) {
      throw forbidden(ERROR.REVIEW_NOT_YOUR_BOOKING);
    }

    if (row.status !== 'completed') throw conflict(ERROR.REVIEW_STAY_NOT_COMPLETED);

    /*
      A courteous early refusal. The unique index is the real control — this check races with a
      concurrent request and the index does not — so a duplicate that gets past here still fails,
      loudly, at the database.
    */
    if (row.already) throw conflict(ERROR.REVIEW_ALREADY_WRITTEN);

    const created = await this.db.transaction(async (tx) => {
      const inserted = await tx.execute<{ id: string; reference: string }>(sql`
        INSERT INTO reviews (booking_id, property_id, unit_id, partner_id,
                             customer_profile_id, rating, body)
        VALUES (${row.id}, ${row.property_id}, ${row.unit_id}, ${row.partner_id},
                ${row.customer_profile_id}, ${input.rating}, ${input.body})
        RETURNING id, reference
      `);

      const review = inserted.rows[0];

      await this.audit.record(
        {
          actorUserId: claims.sub,
          actorRole: claims.role,
          action: 'review.created',
          subjectType: 'review',
          subjectId: review?.id ?? null,
          after: { rating: input.rating, bookingReference: input.bookingReference },
        },
        tx as unknown as Database,
      );

      return { reference: review?.reference ?? '' };
    });

    /*
      AFTER the commit, and outside the transaction.

      Inside it, a mail server that hung would hold a database transaction open for the duration,
      and a send that succeeded before a later rollback would have told the partner about a review
      that does not exist. The review is the fact; the notice is a consequence of it.
    */
    await this.notifyPartnerOfReview(row.partner_id, row.property_id, input.rating);

    return { reference: created.reference, rating: input.rating };
  }

  /**
   * Tells the partner a review arrived.
   *
   * The recipient is derived from the review's OWN partner id — the one just written, taken from
   * the booking — never from anything the caller supplied. That is the visibility rule: a customer
   * writing a review cannot cause an email to reach anybody except the host they stayed with.
   *
   * A partner with no email, or one whose account is closed, is skipped silently. There is nothing
   * the guest should be told about the host's mailbox.
   */
  private async notifyPartnerOfReview(
    partnerId: string,
    propertyId: string,
    rating: number,
  ): Promise<void> {
    const found = await this.db.execute<{
      email: string | null;
      locale: string | null;
      property_name: string | null;
    }>(sql`
      SELECT u.email, u.preferred_locale AS locale, pr.name_ar AS property_name
      FROM partners pa
      JOIN users u      ON u.id = pa.user_id
      JOIN properties pr ON pr.id = ${propertyId}
      WHERE pa.id = ${partnerId} AND u.status = 'active'
    `);

    const row = found.rows[0];

    if (!row?.email) return;

    await this.notifications.notify(
      'review.received',
      reviewReceivedMail({
        to: row.email,
        locale: row.locale ?? 'ar',
        property: row.property_name ?? '',
        rating,
        url: `${this.partnerUrl}/reviews`,
      }),
      row.locale ?? 'ar',
      { partnerId },
    );
  }

  /**
   * The stays this customer may still write about.
   *
   * Drives the account page's prompt. Exactly the bookings `create` would accept — completed,
   * theirs, not yet reviewed — so the list and the endpoint cannot disagree about eligibility and
   * offer a form that then refuses.
   *
   * Bounded rather than paginated: it is a prompt, not a registry, and a customer with more than a
   * handful of unreviewed stays is better served by being asked about the most recent ones.
   */
  async pendingForCustomer(claims: AccessTokenClaims | undefined) {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    /*
      All THREE names, not `coalesce(name_ar, name_en)`.

      That coalesce answered Arabic to every reader, so the English and German account pages showed
      «شقق قصر الشرق المخدومة» in the middle of an otherwise translated page. The customer app is the
      one surface that serves three languages, and it is the caller — not this query — that knows
      which one the reader has chosen: their URL locale, which may differ from the preference stored
      on their account. So the projection carries all three and the client picks with
      `localisedName`, exactly as the catalogue endpoints already do.

      The console and the partner portal keep their `coalesce(name_ar, …)` reads: both are Arabic
      only, so answering Arabic is correct there rather than a bug of the same shape.
    */
    const rows = await this.db.execute<{
      booking_reference: string;
      property_name_ar: string | null;
      property_name_en: string | null;
      property_name_de: string | null;
      unit_name_ar: string | null;
      unit_name_en: string | null;
      unit_name_de: string | null;
      check_in: string;
      check_out: string;
    }>(sql`
      SELECT b.reference AS booking_reference,
             pr.name_ar AS property_name_ar,
             pr.name_en AS property_name_en,
             pr.name_de AS property_name_de,
             un.name_ar AS unit_name_ar,
             un.name_en AS unit_name_en,
             un.name_de AS unit_name_de,
             b.check_in::text, b.check_out::text
      FROM bookings b
      JOIN customer_profiles cp ON cp.id = b.customer_profile_id
      JOIN properties pr ON pr.id = b.property_id
      JOIN units un      ON un.id = b.unit_id
      WHERE cp.user_id = ${claims.sub}
        AND b.status = 'completed'
        AND b.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)
      ORDER BY b.check_out DESC
      LIMIT 10
    `);

    return rows.rows.map((row) => ({
      bookingReference: row.booking_reference,
      property: {
        nameAr: row.property_name_ar,
        nameEn: row.property_name_en,
        nameDe: row.property_name_de,
      },
      unit: {
        nameAr: row.unit_name_ar,
        nameEn: row.unit_name_en,
        nameDe: row.unit_name_de,
      },
      checkIn: row.check_in,
      checkOut: row.check_out,
    }));
  }

  /**
   * تقييماتي — the reviews this customer has WRITTEN.
   *
   * Distinct from `GET /reviews`, which is the partner's list of reviews about them. The account
   * screen previously had no way to show a customer their own words: it said "you have not written
   * one yet" to everybody, because nothing could tell it otherwise.
   *
   * ## Hidden reviews are still shown to their author
   *
   * The same call `forBooking` makes, and for the same reason: a customer who cannot see a review
   * staff have hidden cannot tell "SAFRA removed this" from "it never saved", and the second reading
   * produces a duplicate attempt the unique index then refuses. The status travels so the screen can
   * say which it is.
   *
   * Keyset paginated on `(created_at, id)` through `reviews_customer_idx`. A customer's reviews are
   * bounded by their own stays, but a list endpoint without a page is a list endpoint that grows
   * without one.
   */
  async mineForCustomer(claims: AccessTokenClaims | undefined, query: CursorQuery) {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    const profileId = claims.customerProfileId;

    /* No customer profile, no reviews of one’s own — an empty page rather than an error. */
    if (!profileId) return { items: [], nextCursor: null };

    let after: { sortKey: string; id: string } | null = null;

    if (query.cursor !== undefined) {
      const decoded = decodeCursor(query.cursor);

      if (!decoded || !UUID_PATTERN.test(decoded.id)) {
        throw badRequest(ERROR.REQUEST_CURSOR_INVALID);
      }

      after = { sortKey: decoded.sortKey, id: decoded.id };
    }

    /*
      The sort key stays a STRING: `created_at` holds microseconds and a JS Date holds milliseconds,
      so round-tripping it through a Date truncates the key and repeats the boundary row on the next
      page. `encodeCursor` documents the trap.
    */
    const keyset = after
      ? sql`AND (r.created_at, r.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`
      : sql``;

    const rows = await this.db.execute<{
      reference: string;
      rating: number;
      body: string;
      status: string;
      partner_reply: string | null;
      created_at: string;
      id: string;
      booking_reference: string;
      property_name_ar: string | null;
      property_name_en: string | null;
      property_name_de: string | null;
      unit_name_ar: string | null;
      unit_name_en: string | null;
      unit_name_de: string | null;
    }>(sql`
      SELECT r.reference, r.rating, r.body, r.status::text AS status, r.partner_reply,
             r.created_at::text AS created_at, r.id,
             b.reference AS booking_reference,
             -- All three names: only the client knows the locale the reader chose.
             pr.name_ar AS property_name_ar,
             pr.name_en AS property_name_en,
             pr.name_de AS property_name_de,
             un.name_ar AS unit_name_ar,
             un.name_en AS unit_name_en,
             un.name_de AS unit_name_de
      FROM reviews r
      JOIN bookings b   ON b.id = r.booking_id
      JOIN properties pr ON pr.id = r.property_id
      JOIN units un      ON un.id = r.unit_id
      WHERE r.customer_profile_id = ${profileId}
        ${keyset}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${query.limit + 1}
    `);

    const page = rows.rows.slice(0, query.limit);
    const last = page[page.length - 1];

    return {
      items: page.map((row) => ({
        reference: row.reference,
        bookingReference: row.booking_reference,
        rating: row.rating,
        body: row.body,
        status: row.status,
        partnerReply: row.partner_reply,
        createdAt: row.created_at,
        property: {
          nameAr: row.property_name_ar,
          nameEn: row.property_name_en,
          nameDe: row.property_name_de,
        },
        unit: {
          nameAr: row.unit_name_ar,
          nameEn: row.unit_name_en,
          nameDe: row.unit_name_de,
        },
      })),
      nextCursor:
        rows.rows.length > query.limit && last
          ? encodeCursor(last.created_at, last.id)
          : null,
    };
  }

  /**
   * Whether this customer may review THIS booking, and what they already wrote if they did.
   *
   * ## Why a booking that is not theirs is a 404
   *
   * Not a 403. A different answer for "somebody else's booking" and "no such booking" would let a
   * reference be probed for existence, and a booking reference is a short, guessable-ish string
   * printed on a voucher. The two cases are indistinguishable from outside, deliberately.
   *
   * The REASON is returned rather than a bare boolean, because the screen says something different
   * for each: a stay that has not finished gets "after your stay", and one already reviewed shows
   * the review.
   */
  async forBooking(claims: AccessTokenClaims | undefined, bookingReference: string) {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    const found = await this.db.execute<{
      status: string;
      owner_user_id: string | null;
      property_name_ar: string | null;
      property_name_en: string | null;
      property_name_de: string | null;
      unit_name_ar: string | null;
      unit_name_en: string | null;
      unit_name_de: string | null;
      review_reference: string | null;
      rating: number | null;
      body: string | null;
      review_status: string | null;
      partner_reply: string | null;
      created_at: string | null;
    }>(sql`
      SELECT b.status::text AS status,
             cp.user_id AS owner_user_id,
             -- All three, for the reason recorded on pendingForCustomer above.
             pr.name_ar AS property_name_ar,
             pr.name_en AS property_name_en,
             pr.name_de AS property_name_de,
             un.name_ar AS unit_name_ar,
             un.name_en AS unit_name_en,
             un.name_de AS unit_name_de,
             r.reference AS review_reference,
             r.rating, r.body,
             r.status::text AS review_status,
             r.partner_reply,
             r.created_at::text
      FROM bookings b
      JOIN customer_profiles cp ON cp.id = b.customer_profile_id
      JOIN properties pr ON pr.id = b.property_id
      JOIN units un      ON un.id = b.unit_id
      LEFT JOIN reviews r ON r.booking_id = b.id
      WHERE b.reference = ${bookingReference} AND b.deleted_at IS NULL
    `);

    const row = found.rows[0];

    /* Unknown, or somebody else's — the same answer either way. See the note above. */
    if (!row || !row.owner_user_id || row.owner_user_id !== claims.sub) {
      throw notFound(ERROR.BOOKING_NOT_FOUND);
    }

    const stayCompleted = row.status === 'completed';
    const alreadyReviewed = row.review_reference !== null;

    return {
      property: {
        nameAr: row.property_name_ar,
        nameEn: row.property_name_en,
        nameDe: row.property_name_de,
      },
      unit: {
        nameAr: row.unit_name_ar,
        nameEn: row.unit_name_en,
        nameDe: row.unit_name_de,
      },
      stayCompleted,
      alreadyReviewed,
      eligible: stayCompleted && !alreadyReviewed,
      review: alreadyReviewed
        ? {
            reference: row.review_reference ?? '',
            rating: row.rating ?? 0,
            body: row.body ?? '',
            /*
              The customer sees their own review even when staff have hidden it, and the status
              travels so the screen can say so. Hiding it from its author would leave them unable
              to tell "SAFRA removed this" from "it never saved", and the second reading produces a
              duplicate attempt that the unique index then refuses.
            */
            status: row.review_status ?? 'published',
            partnerReply: row.partner_reply,
            createdAt: row.created_at ?? '',
          }
        : null,
    };
  }

  /**
   * تقييمات ضيوفي — this partner's reviews, and the header figures §7.3 prints.
   *
   * Includes HIDDEN ones. A partner who reported a review and had it upheld should be able to see
   * that it is no longer public; removing it from their own list would leave them unable to tell
   * "SAFRA hid it" from "it never existed", which is the state most likely to generate a second
   * complaint about the first.
   */
  async listForPartner(
    claims: AccessTokenClaims | undefined,
    query: PageQuery,
  ): Promise<OffsetPage<ReviewView> & { summary: ReviewSummary }> {
    const partnerId = requirePartnerId(claims, P.REVIEW_READ_OWN);

    // One fragment, shared by the list and the count — the standing pagination rule.
    const fromWhere = sql`
      FROM reviews r
      JOIN properties pr ON pr.id = r.property_id
      JOIN units un      ON un.id = r.unit_id
      JOIN customer_profiles cp ON cp.id = r.customer_profile_id
      WHERE r.partner_id = ${partnerId}`;

    const [rows, counted, summary] = await Promise.all([
      this.db.execute<ReviewRow>(sql`
        ${REVIEW_COLUMNS}
        ${fromWhere}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
      `),
      this.countOf(fromWhere),
      /*
        The §7.3 header — "المعدل العام ★ 4.7 من 132 تقييماً".

        Averaged over PUBLISHED reviews only, matching what the public sees and what the ranking
        uses. A partner's own average including reviews SAFRA has hidden would disagree with their
        listing page, and the first thing they would do is ask which number is real.
      */
      this.db.execute<{ average: string | null; n: number }>(sql`
        SELECT round(avg(rating)::numeric, 1)::text AS average, count(*)::int AS n
        FROM reviews
        WHERE partner_id = ${partnerId} AND status = 'published'
      `),
    ]);

    const page = offsetPage(rows.rows.map(toView), counted, query);

    return {
      ...page,
      summary: {
        average: summary.rows[0]?.average ?? null,
        published: summary.rows[0]?.n ?? 0,
      },
    };
  }

  /**
   * الرد — the partner's public answer.
   *
   * Once. A reply that can be rewritten after a guest has read it is a different feature with its
   * own questions (does the guest get told? is the old one kept?), and answering them by allowing
   * a silent overwrite is the wrong default for something the public can see.
   */
  async reply(
    claims: AccessTokenClaims | undefined,
    reference: string,
    replyText: string,
  ) {
    const partnerId = requirePartnerId(claims, P.REVIEW_RESPOND_OWN);
    const review = await this.requireOwn(reference, partnerId);

    if (review.partner_reply) throw conflict(ERROR.REVIEW_ALREADY_REPLIED);

    const replied = await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE reviews
        SET partner_reply = ${replyText}, partner_replied_at = now(), updated_at = now()
        WHERE id = ${review.id}
      `);

      await this.audit.record(
        {
          actorUserId: claims?.sub ?? null,
          actorRole: claims?.role,
          action: 'review.replied',
          subjectType: 'review',
          subjectId: review.id,
        },
        tx as unknown as Database,
      );

      return { replied: true as const };
    });

    /*
      The guest is told AFTER the reply is committed, for the same reason the partner is told after
      the review is: the reply is the fact, and an email about a reply that then rolled back is
      worse than a late email.
    */
    await this.notifyCustomerOfReply(reference, partnerId);

    return replied;
  }

  /**
   * Tells the guest their host replied.
   *
   * The recipient comes from the REVIEW's own `customer_profile_id`, which came from the booking.
   * A partner replying cannot address the notice to anybody else — they supply the text and
   * nothing about who reads it.
   *
   * The link points at the public property page rather than at the review: the reply is published
   * there, which is where the guest can see it in the context every other reader sees it in.
   */
  private async notifyCustomerOfReply(
    reference: string,
    partnerId: string,
  ): Promise<void> {
    const found = await this.db.execute<{
      email: string | null;
      locale: string | null;
      slug: string | null;
      property_name: string | null;
      customer_profile_id: string | null;
      booking_id: string | null;
    }>(sql`
      SELECT u.email, u.preferred_locale AS locale,
             pr.slug, pr.name_ar AS property_name,
             r.customer_profile_id, r.booking_id
      FROM reviews r
      JOIN customer_profiles cp ON cp.id = r.customer_profile_id
      JOIN users u              ON u.id = cp.user_id
      JOIN properties pr        ON pr.id = r.property_id
      WHERE r.reference = ${reference}
        AND r.partner_id = ${partnerId}
        AND u.status = 'active'
    `);

    const row = found.rows[0];

    if (!row?.email) return;

    await this.notifications.notify(
      'review.replied',
      reviewRepliedMail({
        to: row.email,
        locale: row.locale ?? 'ar',
        property: row.property_name ?? '',
        url: `${this.appUrl}/${row.locale ?? 'ar'}/property/${row.slug ?? ''}`,
      }),
      row.locale ?? 'ar',
      {
        partnerId,
        ...(row.customer_profile_id
          ? { customerProfileId: row.customer_profile_id }
          : {}),
        ...(row.booking_id ? { bookingId: row.booking_id } : {}),
      },
    );
  }

  /**
   * إبلاغ — the partner asking SAFRA to look.
   *
   * This does NOT hide anything. The review stays published while staff decide, which is the
   * difference between reporting and removing — and the difference P-006 is about. A partner who
   * could take a review off their page by reporting it would report every review below four stars.
   */
  async report(claims: AccessTokenClaims | undefined, reference: string, reason: string) {
    const partnerId = requirePartnerId(claims, P.REVIEW_RESPOND_OWN);
    const review = await this.requireOwn(reference, partnerId);

    if (review.report_status !== 'none') throw conflict(ERROR.REVIEW_ALREADY_REPORTED);

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE reviews
        SET report_status = 'open', report_reason = ${reason},
            reported_at = now(), updated_at = now()
        WHERE id = ${review.id}
      `);

      await this.audit.record(
        {
          actorUserId: claims?.sub ?? null,
          actorRole: claims?.role,
          action: 'review.reported',
          subjectType: 'review',
          subjectId: review.id,
          after: { reason },
        },
        tx as unknown as Database,
      );

      return { reported: true as const };
    });
  }

  /** The staff moderation queue: what partners have reported, oldest first. */
  /**
   * The moderation queue — reported reviews, scoped to the moderator's cities.
   *
   * ## The gap this closes (`O-sec-13`, 2026-08-27)
   *
   * This took no actor at all. A review has no city of its own and inherits one from the PROPERTY
   * it is about, so it is the same shape as a payout inheriting one from its partner: a city-scoped
   * moderator could read every reported review in the country and hide or dismiss any of them.
   *
   * Not the same service as the one `O-sec-4` fixed on 2026-08-20 — that was
   * `admin/review.service.ts`, which reviews PARTNERS and PROPERTIES for approval. Two files named
   * `review.service.ts` doing different jobs is most of why this one was passed over.
   */
  async listReported(
    query: PageQuery,
    actor?: AccessTokenClaims,
  ): Promise<OffsetPage<ReviewView>> {
    const fromWhere = sql`
      FROM reviews r
      JOIN properties pr ON pr.id = r.property_id
      JOIN units un      ON un.id = r.unit_id
      JOIN customer_profiles cp ON cp.id = r.customer_profile_id
      WHERE r.report_status = 'open'
        AND ${scopeFilter(actor, 'pr.city_id')}`;

    const [rows, counted] = await Promise.all([
      this.db.execute<ReviewRow>(sql`
        ${REVIEW_COLUMNS}
        ${fromWhere}
        ORDER BY r.reported_at, r.id
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(rows.rows.map(toView), counted, query);
  }

  /**
   * The staff decision on a reported review.
   *
   * `uphold` hides it; `dismiss` leaves it published. Neither deletes it — the trigger would
   * refuse, and the vocabulary here deliberately avoids suggesting otherwise.
   *
   * The note is required in both directions. A dismissal with no reasoning is the decision a
   * partner is most likely to challenge, and "we looked and disagreed" is a great deal more use to
   * whoever fields that call than an empty field.
   */
  async moderate(
    claims: AccessTokenClaims | undefined,
    reference: string,
    input: ReviewModerateInput,
  ) {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    /*
      Scoped by the PROPERTY's city, both ways — see `listReported`.

      The predicate so an out-of-scope review answers exactly as one that does not exist, and
      `assertCanWrite` so a `read_only` moderator who may legitimately read the queue cannot hide a
      review in a city they do not run.
    */
    const found = await this.db.execute<{
      id: string;
      report_status: string;
      city_id: string | null;
    }>(sql`
      SELECT r.id, r.report_status::text, pr.city_id::text AS city_id
      FROM reviews r
      JOIN properties pr ON pr.id = r.property_id
      WHERE r.reference = ${reference}
        AND ${scopeFilter(claims, 'pr.city_id')}
    `);

    const review = found.rows[0];

    if (!review) throw notFound(ERROR.REVIEW_NOT_FOUND);

    assertCanWrite(claims, review.city_id);

    if (review.report_status !== 'open') throw conflict(ERROR.REVIEW_NOT_REPORTED);

    const upheld = input.decision === 'uphold';

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE reviews
        SET report_status = ${upheld ? 'upheld' : 'dismissed'}::review_report_status,
            status = ${upheld ? 'hidden' : 'published'}::review_status,
            moderated_by_user_id = ${claims.sub},
            moderated_at = now(),
            moderation_note = ${input.note},
            updated_at = now()
        WHERE id = ${review.id}
      `);

      await this.audit.record(
        {
          actorUserId: claims.sub,
          actorRole: claims.role,
          action: upheld ? 'review.hidden' : 'review.report_dismissed',
          subjectType: 'review',
          subjectId: review.id,
          after: { note: input.note },
        },
        tx as unknown as Database,
      );

      return { hidden: upheld };
    });
  }

  /**
   * One review, if it belongs to this partner.
   *
   * The scoping is in the WHERE clause rather than in a check afterwards, so a reference belonging
   * to another partner is indistinguishable from one that does not exist. That is deliberate: a
   * different answer for the two would let a partner probe for the existence of reviews they
   * cannot see.
   */
  private async requireOwn(reference: string, partnerId: string) {
    const found = await this.db.execute<{
      id: string;
      partner_reply: string | null;
      report_status: string;
    }>(sql`
      SELECT id, partner_reply, report_status::text
      FROM reviews
      WHERE reference = ${reference} AND partner_id = ${partnerId}
    `);

    const review = found.rows[0];

    if (!review) throw notFound(ERROR.REVIEW_NOT_FOUND);

    return review;
  }

  /** The count for a page, over the same fragment the list uses, capped so it stops reading. */
  private async countOf(fromWhere: ReturnType<typeof sql>): Promise<number> {
    const result = await this.db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM (SELECT 1 ${fromWhere} LIMIT ${COUNT_CAP + 1}) capped`,
    );

    return Number(result.rows[0]?.n ?? 0);
  }
}

export interface ReviewSummary {
  /** The §7.3 header's ★ figure, over published reviews. Null when there are none. */
  average: string | null;
  published: number;
}

type ReviewRow = {
  reference: string;
  guest_name: string;
  property_name: string;
  unit_name: string;
  rating: number;
  body: string;
  status: string;
  partner_reply: string | null;
  partner_replied_at: string | null;
  report_status: string;
  report_reason: string | null;
  moderation_note: string | null;
  created_at: string;
};

/**
 * One projection, used by every read.
 *
 * The guest's NAME and nothing else about them — no email, no phone, no customer reference. §7.2
 * is explicit that a partner sees no customer contact details, and a review screen is exactly
 * where somebody would be tempted to add "so they can follow up".
 */
const REVIEW_COLUMNS = sql`
  SELECT r.reference,
         cp.full_name AS guest_name,
         coalesce(pr.name_ar, pr.name_en) AS property_name,
         coalesce(un.name_ar, un.name_en) AS unit_name,
         r.rating, r.body,
         r.status::text AS status,
         r.partner_reply, r.partner_replied_at::text,
         r.report_status::text AS report_status,
         r.report_reason, r.moderation_note,
         r.created_at::text
`;

export interface ReviewView {
  reference: string;
  guestName: string;
  propertyName: string | null;
  unitName: string | null;
  rating: number;
  body: string;
  status: string;
  partnerReply: string | null;
  partnerRepliedAt: string | null;
  reportStatus: string;
  reportReason: string | null;
  moderationNote: string | null;
  createdAt: string;
}

function toView(row: ReviewRow): ReviewView {
  return {
    reference: row.reference,
    guestName: row.guest_name,
    propertyName: row.property_name,
    unitName: row.unit_name,
    rating: row.rating,
    body: row.body,
    status: row.status,
    partnerReply: row.partner_reply,
    partnerRepliedAt: row.partner_replied_at,
    reportStatus: row.report_status,
    reportReason: row.report_reason,
    moderationNote: row.moderation_note,
    createdAt: row.created_at,
  };
}
