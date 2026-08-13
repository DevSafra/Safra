import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { imageIsPublished } from '../storage/image-visibility.js';

export interface RecommendationWeights {
  rating: number;
  partnerScore: number;
  responseSpeed: number;
  completeness: number;
  cancellationPenalty: number;
  complaintPenalty: number;
}

/**
 * SRS §5.5: the default ordering is "recommended by SAFRA", computed from the
 * rating, the partner's response speed, few cancellations, image quality, data
 * completeness and complaint count.
 *
 * These weights are the initial calibration and are deliberately in one place so
 * they can move to `settings` once there is real traffic to tune against. They sum
 * to 10 on the positive side, so a score reads as "out of 10".
 */
const WEIGHTS: RecommendationWeights = {
  rating: 3.5, //         guest rating, the strongest signal
  partnerScore: 2.5, //   internal partner score (§8.5), starts at 100
  responseSpeed: 2.0, //  how fast the partner answers within the SLA
  completeness: 2.0, //   photos, description, amenities — proxy for "image quality"
  cancellationPenalty: 1.5,
  complaintPenalty: 1.5,
};

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Recomputes every published property's score in ONE statement.
   *
   * Set-based rather than row-by-row: at 1M users this table is large, and pulling
   * properties into Node to score them individually would be an N+1 that grows with
   * the catalogue. Postgres computes it in a single pass over indexed columns.
   *
   * Idempotent — safe to run repeatedly, and the only writer of
   * `recommendation_score`.
   */
  async recomputeAll(): Promise<{ updated: number }> {
    const started = Date.now();

    const result = await this.db.execute<{ count: string }>(sql`
      WITH scored AS (
        SELECT
          p.id,
          (
            -- Rating, 0–5 normalised. An unrated property scores the midpoint
            -- rather than zero: a new listing should not be buried before it has
            -- had any chance to earn a review.
            ${WEIGHTS.rating}::numeric * COALESCE(p.rating / 5.0, 0.6)

            -- Partner score (§8.5), 0–100 normalised and clamped.
            + ${WEIGHTS.partnerScore}::numeric * LEAST(GREATEST(pa.score, 0), 100) / 100.0

            -- Response speed against the 120-minute SLA (§6.4). Answering in
            -- 10 minutes scores ~0.92; taking the full two hours scores 0.
            + ${WEIGHTS.responseSpeed}::numeric * CASE
                WHEN pa.avg_response_minutes IS NULL THEN 0.5
                ELSE GREATEST(0, 1 - (pa.avg_response_minutes / 120.0))
              END

            -- Data completeness: description, coordinates, photos, amenities.
            -- This is the practical stand-in for §5.5's "image quality" — we can
            -- measure whether photos exist and how many, not how good they look.
            + ${WEIGHTS.completeness}::numeric * (
                (CASE WHEN p.description_ar IS NOT NULL AND length(p.description_ar) >= 120 THEN 0.3 ELSE 0 END)
              + (CASE WHEN p.latitude IS NOT NULL AND p.longitude IS NOT NULL THEN 0.15 ELSE 0 END)
              + LEAST(0.35, img.image_count * 0.07)
              + LEAST(0.2, am.amenity_count * 0.025)
            )

            -- Penalties. Cancellations and complaints both erode trust, which is
            -- principle P-002's whole concern.
            - ${WEIGHTS.cancellationPenalty}::numeric * LEAST(1.0, pa.cancellation_count / 10.0)
            - ${WEIGHTS.complaintPenalty}::numeric * LEAST(1.0, pa.complaint_count / 5.0)
          ) AS raw_score
        FROM properties p
        JOIN partners pa ON pa.id = p.partner_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS image_count
          FROM property_images pi
          /*
            Rendered images only, and this is the one of the four that nothing on any screen shows.
            §5.5 REWARDS photo count, so counting a photograph that has not rendered — or never
            will — lets a partner raise their own recommendation score by uploading files that fail.
          */
          WHERE pi.property_id = p.id AND ${imageIsPublished('pi')}
        ) img ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(DISTINCT ua.amenity_id) AS amenity_count
          FROM units u
          JOIN unit_amenities ua ON ua.unit_id = u.id
          WHERE u.property_id = p.id AND u.deleted_at IS NULL
        ) am ON TRUE
        WHERE p.deleted_at IS NULL
      ),
      applied AS (
        UPDATE properties p
        -- Clamped to the column's numeric(6,3) range and never negative, so a
        -- heavily penalised listing sinks to the bottom rather than overflowing.
        SET recommendation_score = ROUND(LEAST(GREATEST(s.raw_score, 0), 10.0), 3)
        FROM scored s
        WHERE p.id = s.id
          AND p.recommendation_score IS DISTINCT FROM ROUND(LEAST(GREATEST(s.raw_score, 0), 10.0), 3)
        RETURNING 1
      )
      SELECT COUNT(*)::text AS count FROM applied
    `);

    const updated = Number(result.rows[0]?.count ?? 0);
    this.logger.log(
      `Recomputed recommendation scores: ${updated} changed in ${Date.now() - started}ms`,
    );

    return { updated };
  }

  /**
   * Awards the badges §5.6 requires shown on a property card.
   *
   * Derived, never partner-set: `safra_verified` follows from actual verification,
   * and `safra_recommends` from the score and rating clearing a bar. A partner able
   * to award themselves a trust badge would defeat the purpose of having one.
   */
  async refreshBadges(): Promise<{ updated: number }> {
    const result = await this.db.execute<{ count: string }>(sql`
      WITH computed AS (
        SELECT
          p.id,
          ARRAY_REMOVE(ARRAY[
            CASE WHEN p.verified_at IS NOT NULL THEN 'safra_verified' END,
            CASE WHEN p.recommendation_score >= 7.5 AND COALESCE(p.rating, 0) >= 4.5
                 THEN 'safra_recommends' END
          ], NULL) AS badges
        FROM properties p
        WHERE p.deleted_at IS NULL
      ),
      applied AS (
        UPDATE properties p
        SET badges = c.badges
        FROM computed c
        WHERE p.id = c.id AND p.badges IS DISTINCT FROM c.badges
        RETURNING 1
      )
      SELECT COUNT(*)::text AS count FROM applied
    `);

    return { updated: Number(result.rows[0]?.count ?? 0) };
  }

  get weights(): RecommendationWeights {
    return { ...WEIGHTS };
  }
}
