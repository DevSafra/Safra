import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  COUNT_CAP,
  ERROR,
  PERMISSIONS as P,
  type OffsetPage,
  type PageQuery,
  type ReviewCreateInput,
  type ReviewModerateInput,
  offsetPage,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { requirePartnerId } from '../rbac/ownership.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import {
  conflict,
  forbidden,
  notFound,
  unauthorized,
} from '../common/errors/app-error.js';

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
  ) {}

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

    return this.db.transaction(async (tx) => {
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

      return { reference: review?.reference ?? '', rating: input.rating };
    });
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

    return this.db.transaction(async (tx) => {
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
  async listReported(query: PageQuery): Promise<OffsetPage<ReviewView>> {
    const fromWhere = sql`
      FROM reviews r
      JOIN properties pr ON pr.id = r.property_id
      JOIN units un      ON un.id = r.unit_id
      JOIN customer_profiles cp ON cp.id = r.customer_profile_id
      WHERE r.report_status = 'open'`;

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

    const found = await this.db.execute<{ id: string; report_status: string }>(
      sql`SELECT id, report_status::text FROM reviews WHERE reference = ${reference}`,
    );

    const review = found.rows[0];

    if (!review) throw notFound(ERROR.REVIEW_NOT_FOUND);
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
