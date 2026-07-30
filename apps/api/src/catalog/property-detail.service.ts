import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * How many days of calendar the property page shows (§5.6 requires the calendar
 * with available / booked / closed / maintenance states).
 */
const CALENDAR_DAYS = 60;

/**
 * Coordinate precision for PUBLIC display.
 *
 * The approved prototype states it explicitly: "الموقع الدقيق يظهر بعد تأكيد الحجز"
 * — the exact location appears only after the booking is confirmed. Three decimal
 * places is roughly 100 m, enough to show the right neighbourhood on a map without
 * publishing the front door of someone's home to anonymous visitors.
 */
const PUBLIC_COORDINATE_DECIMALS = 3;

@Injectable()
export class PropertyDetailService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Full public detail for one property (§5.6).
   *
   * Only `published` inventory is reachable, so an unverified or suspended listing
   * 404s exactly like a nonexistent one — no way to tell from outside whether a
   * slug exists but is hidden.
   */
  async bySlug(slug: string) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT
        p.reference, p.slug,
        p.name_ar, p.name_en, p.name_de,
        p.description_ar, p.description_en, p.description_de,
        p.address, p.latitude, p.longitude,
        p.rating, p.reviews_count, p.badges, p.attributes,
        ci.slug AS city_slug, ci.name_ar AS city_name_ar, ci.name_en AS city_name_en,
        ci.name_de AS city_name_de, ci.timezone AS city_timezone,
        co.code AS country_code,
        pt.code AS property_type_code,
        cp.code AS policy_code, cp.name_ar AS policy_name_ar, cp.name_en AS policy_name_en,
        cp.name_de AS policy_name_de, cp.description_ar AS policy_description_ar,
        cp.description_en AS policy_description_en, cp.description_de AS policy_description_de,
        cp.tiers AS policy_tiers, cp.min_refund_percent AS policy_min_refund
      FROM properties p
      JOIN cities ci ON ci.id = p.city_id
      JOIN countries co ON co.id = ci.country_id
      JOIN property_types pt ON pt.id = p.property_type_id
      JOIN cancellation_policies cp ON cp.id = p.cancellation_policy_id
      WHERE p.slug = ${slug}
        AND p.status = 'published'
        AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const row = rows.rows[0];
    if (!row) throw new NotFoundException('Property not found.');

    const [units, images, calendar, fees] = await Promise.all([
      this.units(slug),
      this.images(slug),
      this.calendar(slug),
      this.publicFees(),
    ]);

    return {
      reference: row['reference'],
      slug: row['slug'],
      name: {
        ar: row['name_ar'],
        en: row['name_en'],
        de: row['name_de'],
      },
      description: {
        ar: row['description_ar'],
        en: row['description_en'],
        de: row['description_de'],
      },
      // The street address is withheld entirely until a booking is confirmed
      // (P-001: the customer's relationship is with SAFRA, not the property).
      // Narrowed rather than String()-coerced: a raw SQL row is `unknown`, and
      // coercing an unexpected object would publish "[object Object]" as an address.
      addressApproximate: firstAddressLine(
        typeof row['address'] === 'string' ? row['address'] : '',
      ),
      latitude: fuzzCoordinate(row['latitude']),
      longitude: fuzzCoordinate(row['longitude']),
      exactLocationAfterBooking: true,
      city: {
        slug: row['city_slug'],
        nameAr: row['city_name_ar'],
        nameEn: row['city_name_en'],
        nameDe: row['city_name_de'],
        timezone: row['city_timezone'],
        countryCode: row['country_code'],
      },
      propertyTypeCode: row['property_type_code'],
      rating: row['rating'],
      reviewsCount: Number(row['reviews_count'] ?? 0),
      badges: row['badges'],
      attributes: row['attributes'],
      cancellationPolicy: {
        code: row['policy_code'],
        nameAr: row['policy_name_ar'],
        nameEn: row['policy_name_en'],
        nameDe: row['policy_name_de'],
        descriptionAr: row['policy_description_ar'],
        descriptionEn: row['policy_description_en'],
        descriptionDe: row['policy_description_de'],
        tiers: row['policy_tiers'],
        minRefundPercent: Number(row['policy_min_refund'] ?? 50),
      },
      units,
      images,
      calendar,
      fees,
    };
  }

  private async units(slug: string) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT
        u.id, u.name_ar, u.name_en, u.name_de,
        u.max_guests, u.bedrooms, u.beds, u.bathrooms,
        u.base_price, u.min_nights, u.max_nights, u.room_type_code,
        cur.code AS currency_code,
        COALESCE(
          ARRAY_AGG(a.code ORDER BY a.sort_order) FILTER (WHERE a.code IS NOT NULL),
          '{}'
        ) AS amenity_codes
      FROM units u
      JOIN properties p ON p.id = u.property_id
      JOIN currencies cur ON cur.id = u.currency_id
      LEFT JOIN unit_amenities ua ON ua.unit_id = u.id
      LEFT JOIN amenities a ON a.id = ua.amenity_id AND a.deleted_at IS NULL
      WHERE p.slug = ${slug} AND u.is_active AND u.deleted_at IS NULL
      GROUP BY u.id, cur.code
      ORDER BY u.base_price
    `);

    return rows.rows.map((r) => ({
      id: r['id'],
      name: { ar: r['name_ar'], en: r['name_en'], de: r['name_de'] },
      maxGuests: Number(r['max_guests']),
      bedrooms: Number(r['bedrooms']),
      beds: Number(r['beds']),
      bathrooms: Number(r['bathrooms']),
      basePrice: r['base_price'],
      currencyCode: r['currency_code'],
      minNights: Number(r['min_nights']),
      maxNights: r['max_nights'] === null ? null : Number(r['max_nights']),
      roomTypeCode: r['room_type_code'],
      amenityCodes: r['amenity_codes'],
    }));
  }

  private async images(slug: string) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT i.file_key, i.alt_ar, i.alt_en, i.alt_de, i.width, i.height, i.variant_widths, i.is_cover
      FROM property_images i
      JOIN properties p ON p.id = i.property_id
      WHERE p.slug = ${slug} AND i.deleted_at IS NULL
      ORDER BY i.is_cover DESC, i.sort_order
    `);

    return rows.rows.map((r) => ({
      fileKey: r['file_key'],
      alt: { ar: r['alt_ar'], en: r['alt_en'], de: r['alt_de'] },
      width: r['width'] === null ? null : Number(r['width']),
      height: r['height'] === null ? null : Number(r['height']),
      variantWidths: (r['variant_widths'] as number[] | null) ?? [],
      isCover: r['is_cover'] === true,
    }));
  }

  /**
   * Per-day availability across every unit, as §5.6's calendar.
   *
   * A date is shown as available if ANY unit is bookable on it — the calendar
   * answers "can I stay here?", not "is room 204 free?". Booked state is derived
   * from real bookings, never from what a partner declared.
   */
  private async calendar(slug: string) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      WITH days AS (
        SELECT d.day::date AS date
        FROM generate_series(
          CURRENT_DATE, CURRENT_DATE + ${CALENDAR_DAYS}::int, INTERVAL '1 day'
        ) AS d(day)
      ),
      unit_days AS (
        SELECT
          days.date,
          u.id AS unit_id,
          CASE
            WHEN b.id IS NOT NULL THEN 'booked'
            ELSE COALESCE(ad.status::text, 'available')
          END AS status,
          COALESCE(ad.price, u.base_price) AS price
        FROM days
        CROSS JOIN units u
        JOIN properties p ON p.id = u.property_id
        LEFT JOIN availability_days ad ON ad.unit_id = u.id AND ad.date = days.date
        LEFT JOIN bookings b
          ON b.unit_id = u.id
         AND b.status IN ('pending_payment', 'pending_confirmation', 'confirmed', 'checked_in')
         AND days.date >= b.check_in AND days.date < b.check_out
        WHERE p.slug = ${slug} AND u.is_active AND u.deleted_at IS NULL
      )
      SELECT
        date::text AS date,
        -- 'available' wins if any unit is free; otherwise report the state that
        -- blocks it, preferring 'booked' as the most informative.
        CASE
          WHEN BOOL_OR(status = 'available') THEN 'available'
          WHEN BOOL_OR(status = 'booked') THEN 'booked'
          WHEN BOOL_OR(status = 'maintenance') THEN 'maintenance'
          ELSE 'closed'
        END AS status,
        MIN(price) FILTER (WHERE status = 'available')::text AS from_price
      FROM unit_days
      GROUP BY date
      ORDER BY date
    `);

    return rows.rows.map((r) => ({
      date: r['date'],
      status: r['status'],
      fromPrice: r['from_price'],
    }));
  }

  /** §5.6 requires SAFRA's fees to be visible on the property page. */
  private async publicFees() {
    const mode = await this.settings.get<string>('commission.customer_fee_mode', 'flat');
    const value = await this.settings.getNumber('commission.customer_fee_value', 0);

    return { customerFeeMode: mode, customerFeeValue: value };
  }
}

/** Rounds a coordinate to roughly 100 m for public display. */
function fuzzCoordinate(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  return parsed.toFixed(PUBLIC_COORDINATE_DECIMALS);
}

/**
 * Keeps only the first comma-separated component of an address.
 *
 * "Bab Touma, Old City, Damascus" becomes "Bab Touma" — enough context to judge the
 * area, not enough to find the building before a booking exists.
 */
function firstAddressLine(address: string): string {
  const [first] = address.split(',');
  return (first ?? '').trim();
}
