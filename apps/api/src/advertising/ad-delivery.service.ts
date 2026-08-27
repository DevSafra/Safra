import { Inject, Injectable, Logger } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';

import { schema, type Database } from '@safra/db';
import { ERROR, type DeliveredAd } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { notFound } from '../common/errors/app-error.js';
import { describeError } from '../common/errors/safe-error.js';
import { ImageService } from '../storage/image.service.js';
import { creativeUrl } from '../admin/ad-creative.service.js';

/** How many ads one city page may carry. */
const SLOTS = 3;

/**
 * Serving ads to customers, and counting what they saw — §9.3's الإعلانات.
 *
 * ## Never mixed into ranking
 *
 * The schema says this and it is enforced here by shape rather than by discipline: this service
 * returns ads through its own call, and search returns properties through its own. There is no
 * ordering, boost or priority anywhere in either — «always labelled إعلان شريك, never mixed with
 * organic results» stays true because there is no mechanism by which it could stop being true.
 *
 * ## Only a live campaign is ever served
 *
 * `active`, inside its window, in the city being looked at. A draft, a paused campaign and one
 * whose window closed are all invisible — and the window is decided against the CLOCK here, not
 * against the status column, so the hour between a campaign lapsing and the sweep retiring it does
 * not deliver impressions nobody bought. That was the whole defect on this page.
 *
 * ## Impressions are counted SERVER-side
 *
 * Not by a call the browser makes. A public «count an impression» endpoint is a number anybody can
 * inflate, and an advertiser paying against inflated figures is being defrauded with SAFRA's own
 * API. What is counted is what this service actually returned.
 */
@Injectable()
export class AdDeliveryService {
  private readonly logger = new Logger(AdDeliveryService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly images: ImageService,
  ) {}

  /**
   * The live ads for one city, in the reader's language.
   *
   * Ordered by `starts_at` rather than by anything performance-related: an auction, a click-through
   * ranking or a paid priority would be exactly the mechanism the schema refuses to have. Oldest
   * campaign first is arbitrary, stable and unbuyable.
   */
  async forCity(citySlug: string, locale: 'ar' | 'en' | 'de'): Promise<DeliveredAd[]> {
    const headline =
      locale === 'en'
        ? sql`c.headline_en`
        : locale === 'de'
          ? sql`c.headline_de`
          : sql`c.headline_ar`;

    const rows = await this.db.execute<{
      reference: string;
      headline: string;
      advertiser: string;
      kind: string;
      image_file_key: string | null;
      image_variant_widths: number[] | null;
    }>(sql`
      SELECT c.reference, ${headline} AS headline, a.name AS advertiser,
             a.kind::text AS kind,
             -- Only a FINISHED render. A key whose variants are still being written is an address,
             -- not a picture, and a customer meeting it sees a broken image on their booking.
             CASE WHEN c.image_status = 'ready' THEN c.image_file_key END AS image_file_key,
             c.image_variant_widths
      FROM ad_campaigns c
      JOIN advertisers a ON a.id = c.advertiser_id
      JOIN cities ci     ON ci.id = c.city_id
      WHERE ci.slug = ${citySlug}
        AND ci.deleted_at IS NULL
        AND c.deleted_at IS NULL
        AND c.status = 'active'
        AND c.starts_at <= now()
        AND c.ends_at   >  now()
      ORDER BY c.starts_at, c.id
      LIMIT ${SLOTS}
    `);

    if (rows.rows.length > 0)
      await this.countImpressions(rows.rows.map((r) => r.reference));

    return rows.rows.map((row) => ({
      reference: row.reference,
      headline: row.headline,
      advertiser: row.advertiser,
      kind: row.kind as DeliveredAd['kind'],
      /*
        The CLICK path on SAFRA, never the advertiser's own URL.

        Handing the browser the target directly would mean no click could be counted and the
        advertiser would be paying for a number nobody measured. It also keeps the destination out
        of the page source, where it is one copy-paste from being reused elsewhere as ours.
      */
      clickPath: `/api/v1/ads/${row.reference}/click`,
      imageUrl: row.image_file_key
        ? creativeUrl(this.images, row.image_file_key, row.image_variant_widths)
        : null,
    }));
  }

  /**
   * One statement for the whole slate, and a failure here never fails the page.
   *
   * A customer looking at a city must not get an error because a counter could not be written —
   * the ad is already rendered by the time this matters, and a lost impression is a smaller wrong
   * than a broken page. It is logged rather than swallowed silently.
   */
  private async countImpressions(references: string[]): Promise<void> {
    try {
      /*
        `inArray`, not `= ANY(${'${list}'}::text[])`.

        A JS array inside a `sql` template expands to a TUPLE rather than a Postgres array, which is
        a documented trap in this codebase — it has already produced a delete that silently matched
        nothing and reported success.
      */
      await this.db.execute(sql`
        UPDATE ad_campaigns
        SET impressions = impressions + 1
        WHERE ${inArray(schema.adCampaigns.reference, references)}
      `);
    } catch (error) {
      this.logger.warn(`Could not record impressions: ${describeError(error)}`);
    }
  }

  /**
   * Records a click and answers where to send the customer.
   *
   * The destination comes from the ROW, never from the request. A redirect target a caller can
   * influence is an open redirect on SAFRA's own domain — a phishing primitive carrying our name —
   * and this endpoint exists precisely because the browser must not hold the URL.
   *
   * A campaign that is not live answers 404 rather than redirecting: a click on a stale page
   * should not deliver traffic the advertiser has stopped paying for.
   */
  async click(reference: string): Promise<string> {
    const rows = await this.db.execute<{ id: string; target_url: string }>(sql`
      SELECT id, target_url FROM ad_campaigns
      WHERE reference = ${reference}
        AND deleted_at IS NULL
        AND status = 'active'
        AND starts_at <= now()
        AND ends_at   >  now()
    `);

    const campaign = rows.rows.at(0);

    if (!campaign) throw notFound(ERROR.CAMPAIGN_NOT_FOUND);

    await this.db
      .execute(
        sql`
        UPDATE ad_campaigns SET clicks = clicks + 1 WHERE id = ${campaign.id}::uuid
      `,
      )
      .catch((error: unknown) => {
        /*
          Never fail the customer's click over a counter — and this one CAN fail legitimately.

          `ad_campaigns_clicks_within_impressions` refuses a click that would exceed the campaign's
          impressions, which is right: you cannot click what you were never shown. A click arriving
          without one — a bookmarked click URL, a page restored from history days later — is refused
          by the database, and losing it is the correct outcome rather than breaking the invariant.

          Logged with the REFERENCE so an advertiser asking why a click is missing has something to
          chase. Silently dropping it would make the counter under-report with no signal at all.
        */
        this.logger.warn(
          `Could not record a click on ${reference}: ${describeError(error)}`,
        );
      });

    return campaign.target_url;
  }
}
