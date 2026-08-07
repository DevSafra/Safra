import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import type { PartnerVerifyInput, PropertyReviewInput } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { SanctionsService } from '../sanctions/sanctions.service.js';
import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { ERROR } from '@safra/contracts';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';

/**
 * Staff verification of partners and listings (SRS §8.1, §9.2).
 *
 * This is where principle P-002 — "trust before volume" — stops being a slogan.
 * Nothing reaches search without passing through here, and every decision is
 * recorded with who made it, when, and why.
 */
@Injectable()
export class ReviewService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly sanctions: SanctionsService,
  ) {}

  /** §9.2's "properties awaiting approval" queue, oldest first so nothing rots. */
  async pendingProperties(limit = 50) {
    return this.db.query.properties.findMany({
      where: and(
        eq(schema.properties.status, 'pending_review'),
        isNull(schema.properties.deletedAt),
      ),
      columns: {
        reference: true,
        slug: true,
        nameAr: true,
        nameEn: true,
        address: true,
        latitude: true,
        longitude: true,
        descriptionAr: true,
        createdAt: true,
        reviewNotes: true,
      },
      with: {
        partner: { columns: { reference: true, displayName: true, verification: true } },
        city: { columns: { slug: true, nameAr: true } },
      },
      orderBy: (p, { asc }) => [asc(p.createdAt)],
      limit,
    });
  }

  /** §9.2's "partners awaiting approval". */
  async pendingPartners(limit = 50) {
    return this.db.query.partners.findMany({
      where: and(
        eq(schema.partners.verification, 'pending'),
        isNull(schema.partners.deletedAt),
      ),
      columns: {
        reference: true,
        displayName: true,
        legalName: true,
        email: true,
        phone: true,
        verification: true,
        sanctionsScreenedAt: true,
        createdAt: true,
      },
      with: {
        documents: { columns: { kind: true, status: true, fileName: true } },
        city: { columns: { slug: true, nameAr: true } },
      },
      orderBy: (p, { asc }) => [asc(p.createdAt)],
      limit,
    });
  }

  /**
   * One listing, everything a reviewer needs to decide (§8.1, P-002).
   *
   * Includes the PARTNER's verification state, which is the thing most likely to make
   * the decision moot: item 116 refuses to publish a listing whose partner is not yet
   * verified, so a reviewer who cannot see that would approve and get a conflict they
   * have no way to explain.
   */
  async propertyDetail(reference: string) {
    const property = await this.db.query.properties.findFirst({
      where: and(
        eq(schema.properties.reference, reference),
        isNull(schema.properties.deletedAt),
      ),
      columns: {
        reference: true,
        slug: true,
        nameAr: true,
        nameEn: true,
        descriptionAr: true,
        descriptionEn: true,
        address: true,
        latitude: true,
        longitude: true,
        status: true,
        reviewNotes: true,
        attributes: true,
        createdAt: true,
      },
      with: {
        partner: {
          columns: {
            reference: true,
            displayName: true,
            legalName: true,
            verification: true,
          },
        },
        city: { columns: { slug: true, nameAr: true, nameEn: true } },
        propertyType: { columns: { code: true } },
        /**
         * The photos are the review. §5.6's gallery is what a customer sees, and a
         * listing approved without looking at them is the whole of P-002 skipped.
         */
        images: {
          columns: { fileKey: true, width: true, height: true, isCover: true },
        },
        units: {
          columns: { nameEn: true, maxGuests: true, basePrice: true, minNights: true },
        },
      },
    });

    if (!property) throw notFound(ERROR.PROPERTY_NOT_FOUND);

    return property;
  }

  /**
   * Approve or reject a submitted listing.
   *
   * Approval publishes directly rather than stopping at an intermediate `approved`
   * state: the SRS treats verification and going live as one decision, and a
   * listing sitting verified-but-invisible would just be a second queue for staff
   * to forget about.
   */
  async reviewProperty(
    claims: AccessTokenClaims | undefined,
    reference: string,
    input: PropertyReviewInput,
  ) {
    const property = await this.db.query.properties.findFirst({
      where: and(
        eq(schema.properties.reference, reference),
        isNull(schema.properties.deletedAt),
      ),
      columns: { id: true, status: true, partnerId: true },
    });

    if (!property) throw notFound(ERROR.PROPERTY_NOT_FOUND);

    if (property.status !== 'pending_review') {
      throw conflict(ERROR.PROPERTY_NOT_REVIEWABLE);
    }

    if (input.decision === 'approve') {
      /**
       * The partner must be verified before ANY of their listings can publish.
       *
       * §8.1 requires document verification at the partner level, and approving a
       * property would otherwise quietly bypass it — putting an unvetted operator
       * in front of paying customers, which is precisely what P-002 forbids.
       */
      const partner = await this.db.query.partners.findFirst({
        where: eq(schema.partners.id, property.partnerId),
        columns: { verification: true, reference: true, sanctionsScreenedAt: true },
      });

      if (partner?.verification !== 'approved') {
        throw conflict(ERROR.PARTNER_NOT_VERIFIED);
      }
    }

    const nextStatus = input.decision === 'approve' ? 'published' : 'rejected';

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.properties)
        .set({
          status: nextStatus,
          reviewNotes: input.notes ?? null,
          reviewedAt: new Date(),
          // verifiedAt is set ONLY on approval, and never cleared on rejection —
          // it records that a human checked this listing, which stays true.
          ...(input.decision === 'approve'
            ? { verifiedAt: new Date(), verifiedByUserId: claims?.sub ?? null }
            : {}),
        })
        .where(eq(schema.properties.id, property.id));

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: `property.${input.decision === 'approve' ? 'approved' : 'rejected'}`,
          subjectType: 'property',
          subjectId: property.id,
          before: { status: property.status },
          after: { status: nextStatus },
          reason: input.notes ?? null,
        },
        tx as unknown as Database,
      );

      await tx.insert(schema.timelineEvents).values({
        subjectType: 'property',
        subjectId: property.id,
        eventType: `property.${input.decision === 'approve' ? 'approved' : 'rejected'}`,
        actorType: 'staff',
        actorUserId: claims?.sub ?? null,
        payload: { notes: input.notes ?? null },
      });
    });

    return { reference, status: nextStatus, notes: input.notes ?? null };
  }

  /**
   * One partner, everything a reviewer needs to decide (§8.1).
   *
   * Separate from the queue rather than reusing it: the queue is a list of what is
   * waiting and is capped, while this is the evidence for a single decision — the
   * documents with their individual review state, the screening result, and the
   * listings that will go live the moment this partner is approved.
   *
   * That last one matters and is easy to omit. Approving a partner is not an
   * isolated act; item 116 means their submitted listings become publishable, so a
   * reviewer who cannot see what they are about to unlock is deciding half-blind.
   */
  async partnerDetail(reference: string) {
    const partner = await this.db.query.partners.findFirst({
      where: and(
        eq(schema.partners.reference, reference),
        isNull(schema.partners.deletedAt),
      ),
      columns: {
        reference: true,
        legalName: true,
        displayName: true,
        email: true,
        phone: true,
        address: true,
        verification: true,
        verifiedAt: true,
        sanctionsScreenedAt: true,
        sanctionsScreeningResult: true,
        suspendedAt: true,
        suspendedReason: true,
        createdAt: true,
      },
      with: {
        city: { columns: { slug: true, nameAr: true, nameEn: true } },
        /*
          `nameAr` alongside the code. The console printed the CODE — «accommodation» beside
          Arabic on the partner screen (Bashar, 2026-08-06) — while the الشركاء registry has
          selected the Arabic name since the same defect was fixed there. The code stays in the
          response because it is the machine identifier; the name is what a person reads.
        */
        partnerType: { columns: { code: true, nameAr: true, nameEn: true } },
        documents: {
          columns: {
            id: true,
            kind: true,
            fileName: true,
            status: true,
            reviewNotes: true,
            reviewedAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!partner) throw notFound(ERROR.PARTNER_NOT_FOUND);

    /**
     * Their listings, so the reviewer sees the consequence of approving.
     *
     * A separate query rather than another relation: `properties` is not declared as
     * a relation on `partners`, and adding one to serve a single screen would widen
     * the relational graph for every other query that touches a partner.
     */
    const properties = await this.db.execute<{
      reference: string;
      name_ar: string;
      name_en: string | null;
      status: string;
    }>(sql`
      SELECT reference, name_ar, name_en, status::text AS status
      FROM properties
      WHERE partner_id = (SELECT id FROM partners WHERE reference = ${reference})
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 50
    `);

    /**
     * Whether this partner holds a second factor.
     *
     * A boolean and nothing else. The reviewer needs it to answer "have they enrolled yet" before
     * offering a reset; the secret, the recovery codes and their count are none of the console's
     * business, and selecting them here would put them in a response that has no use for them.
     *
     * A separate query because `users` is not a relation on `partners` in this graph, and the
     * alternative — widening `partnerDetail`'s relation set — would attach a user row to every
     * other caller that wants a partner.
     */
    const account = await this.db.execute<{ two_factor_enabled: boolean }>(sql`
      SELECT (u.totp_enabled_at IS NOT NULL) AS two_factor_enabled
      FROM users u
      JOIN partners p ON p.user_id = u.id
      WHERE p.reference = ${reference}
    `);

    return {
      ...partner,
      /* No user account behind the partner reads as "not enrolled", which it is. */
      twoFactorEnabled: account.rows[0]?.two_factor_enabled ?? false,
      properties: properties.rows.map((row) => ({
        reference: row.reference,
        nameAr: row.name_ar,
        nameEn: row.name_en,
        status: row.status,
      })),
    };
  }

  /**
   * Verify or reject a partner (§8.1).
   *
   * Approval requires that sanctions screening has been recorded. That is not
   * bureaucracy: the general Syria sanctions programme was repealed in 2025 but
   * residual SDN designations and export controls survive it, so onboarding an
   * unscreened counterparty is a live legal risk (see ADR 0002).
   */
  async verifyPartner(
    claims: AccessTokenClaims | undefined,
    reference: string,
    input: PartnerVerifyInput,
  ) {
    const partner = await this.db.query.partners.findFirst({
      where: and(
        eq(schema.partners.reference, reference),
        isNull(schema.partners.deletedAt),
      ),
      columns: { id: true, verification: true, sanctionsScreenedAt: true },
    });

    if (!partner) throw notFound(ERROR.PARTNER_NOT_FOUND);

    if (partner.verification === 'approved' && input.decision === 'approve') {
      throw conflict(ERROR.PARTNER_ALREADY_VERIFIED);
    }

    if (input.decision === 'approve' && partner.sanctionsScreenedAt === null) {
      throw badRequest(ERROR.PARTNER_SANCTIONS_SCREENING_REQUIRED);
    }

    const nextStatus = input.decision === 'approve' ? 'approved' : 'rejected';

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.partners)
        .set({
          verification: nextStatus,
          ...(input.decision === 'approve'
            ? { verifiedAt: new Date(), verifiedByUserId: claims?.sub ?? null }
            : {}),
        })
        .where(eq(schema.partners.id, partner.id));

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: `partner.${nextStatus}`,
          subjectType: 'partner',
          subjectId: partner.id,
          before: { verification: partner.verification },
          after: { verification: nextStatus },
          reason: input.notes ?? null,
        },
        tx as unknown as Database,
      );

      await tx.insert(schema.timelineEvents).values({
        subjectType: 'partner',
        subjectId: partner.id,
        eventType: `partner.${nextStatus}`,
        actorType: 'staff',
        actorUserId: claims?.sub ?? null,
        payload: { notes: input.notes ?? null },
      });

      /**
       * Rejecting or suspending a partner must take their live listings down with
       * them — otherwise an unverified operator keeps selling. Suspension, never
       * deletion (P-003).
       */
      if (input.decision === 'reject') {
        await tx
          .update(schema.properties)
          .set({ status: 'suspended' })
          .where(
            and(
              eq(schema.properties.partnerId, partner.id),
              eq(schema.properties.status, 'published'),
            ),
          );
      }
    });

    return { reference, verification: nextStatus };
  }

  /** Records that screening was performed, with the provider's raw result. */
  /**
   * RUNS a screening against the imported list and records the result (ADR 0002).
   *
   * This used to accept whatever result the caller supplied, which meant the legal
   * obligation was satisfied by a staff member asserting they had checked. Now the
   * platform performs the search itself against the newest EU consolidated-list
   * snapshot, and the recorded result is what the search actually returned.
   *
   * A reviewer can still override the outcome — `matched` is theirs to set, because
   * only a human can judge whether a fuzzy hit is the same person — but they are
   * overriding evidence rather than producing it from nothing.
   */
  async recordSanctionsScreening(
    claims: AccessTokenClaims | undefined,
    reference: string,
    input: { matched?: boolean | undefined; notes?: string | undefined },
  ) {
    const partner = await this.db.query.partners.findFirst({
      where: and(
        eq(schema.partners.reference, reference),
        isNull(schema.partners.deletedAt),
      ),
      columns: { id: true, legalName: true, displayName: true },
    });

    if (!partner) throw notFound(ERROR.PARTNER_NOT_FOUND);

    /**
     * Both names are searched. A designation may name the company or the person
     * signing for it, and a partner registers with both.
     */
    const outcome = await this.sanctions.screen([partner.legalName, partner.displayName]);

    /**
     * The reviewer's judgement wins over the machine's, in EITHER direction.
     *
     * Up, because a reviewer who recognises a name the matcher scored as weak must
     * be able to flag it. Down, because the matcher deliberately over-flags and a
     * human confirming "different person, different country, different birth year"
     * is exactly the decision this design reserves for people.
     */
    const matched = input.matched ?? outcome.matched;

    const result = {
      ...outcome,
      matched,
      /** Recorded when the reviewer disagreed with the automated reading. */
      ...(input.matched !== undefined && input.matched !== outcome.matched
        ? { overriddenBy: claims?.sub ?? null, automatedMatch: outcome.matched }
        : {}),
      ...(input.notes ? { reviewerNotes: input.notes } : {}),
    };

    await this.db
      .update(schema.partners)
      .set({ sanctionsScreenedAt: new Date(), sanctionsScreeningResult: result })
      .where(eq(schema.partners.id, partner.id));

    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action: 'partner.sanctions_screened',
      subjectType: 'partner',
      subjectId: partner.id,
      after: {
        screenedAt: new Date().toISOString(),
        source: outcome.source,
        snapshotId: outcome.snapshotId,
        candidateCount: outcome.candidates.length,
        matched,
        automatedMatch: outcome.matched,
      },
    });

    return { reference, screened: true, matched, candidates: outcome.candidates };
  }

  /** Counts for the §9.2 "needs your attention now" panel. */
  async attentionCounts() {
    const rows = await this.db.execute<{ metric: string; count: string }>(sql`
      SELECT 'properties_pending_review' AS metric, COUNT(*)::text AS count
        FROM properties WHERE status = 'pending_review' AND deleted_at IS NULL
      UNION ALL
      SELECT 'partners_pending_verification', COUNT(*)::text
        FROM partners WHERE verification = 'pending' AND deleted_at IS NULL
      UNION ALL
      SELECT 'partners_unscreened', COUNT(*)::text
        FROM partners WHERE sanctions_screened_at IS NULL AND deleted_at IS NULL
      UNION ALL
      SELECT 'bookings_awaiting_confirmation', COUNT(*)::text
        FROM bookings WHERE status = 'pending_confirmation' AND deleted_at IS NULL
      UNION ALL
      -- SLA about to lapse: the single most time-critical queue (§6.4).
      SELECT 'bookings_sla_expiring_within_30m', COUNT(*)::text
        FROM bookings
        WHERE status = 'pending_confirmation'
          AND confirmation_deadline_at IS NOT NULL
          AND confirmation_deadline_at <= now() + INTERVAL '30 minutes'
          AND deleted_at IS NULL
    `);

    return Object.fromEntries(rows.rows.map((r) => [r.metric, Number(r.count)]));
  }
}
