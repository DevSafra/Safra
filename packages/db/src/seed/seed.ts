import { and, eq, sql } from 'drizzle-orm';

import { type Database } from '../client.js';
import * as schema from '../schema/index.js';
import {
  AMENITIES,
  CANCELLATION_POLICIES,
  CITIES,
  COUNTRIES,
  CURRENCIES,
  LANDMARK_KINDS,
  LANDMARKS,
  PARTNER_TYPES,
  PROPERTY_TYPES,
  SETTINGS,
} from './reference.js';

/**
 * Seeds reference data. Safe to run on every deploy.
 *
 * ## It inserts what is MISSING and never touches what is there (2026-10-06)
 *
 * Every row here was an upsert on its natural key, so each deploy wrote the seed's
 * names, symbols, coordinates, refund tiers and capabilities back over whatever the
 * console had made of them. Staff edit every one of these tables from the console,
 * and an edit that lasts until the next deploy is not an edit: an operator who
 * corrected a city's description, moved a landmark or tuned a cancellation policy's
 * tiers watched it revert, with no audit row saying who reverted it.
 *
 * So a row is keyed on its natural key across ALL rows, retired ones included, and
 * a row that exists in any state is left exactly as it is. A retired amenity is not
 * reinstated and a renamed city is not renamed back. Settings already worked this way
 * and were the model.
 *
 * The cost, accepted: a correction to `reference.ts` reaches a fresh database and no
 * existing one. A correction that must reach existing data is a one-off post/ file
 * guarded so it cannot overwrite an edit made since (post/0019 and post/0017 are the
 * pattern), which keeps it a deliberate act rather than a side effect of deploying.
 *
 * There is no truncate anywhere in this file — principle P-003 forbids destructive
 * operations, and a seed that wipes tables is exactly how a production dataset gets
 * lost.
 */
export async function seed(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    // ── Currencies ───────────────────────────────────────────────────────────
    for (const c of CURRENCIES) {
      await tx
        .insert(schema.currencies)
        .values(c)
        .onConflictDoNothing({ target: schema.currencies.code });
    }
    console.log(`  currencies:          ${CURRENCIES.length}`);

    const currencyIds = new Map(
      (
        await tx
          .select({ id: schema.currencies.id, code: schema.currencies.code })
          .from(schema.currencies)
      ).map((r) => [r.code, r.id]),
    );

    // ── Countries ────────────────────────────────────────────────────────────
    for (const c of COUNTRIES) {
      const displayCurrencyId = currencyIds.get(c.displayCurrency);
      if (!displayCurrencyId) {
        throw new Error(
          `Country ${c.code} references unknown currency ${c.displayCurrency}.`,
        );
      }

      await tx
        .insert(schema.countries)
        .values({
          code: c.code,
          nameAr: c.nameAr,
          nameEn: c.nameEn,
          nameDe: c.nameDe,
          displayCurrencyId,
          isLaunchMarket: c.isLaunchMarket,
        })
        .onConflictDoNothing({ target: schema.countries.code });
    }
    console.log(`  countries:           ${COUNTRIES.length}`);

    const countryIds = new Map(
      (
        await tx
          .select({ id: schema.countries.id, code: schema.countries.code })
          .from(schema.countries)
      ).map((r) => [r.code, r.id]),
    );

    // ── Cities ───────────────────────────────────────────────────────────────
    for (const c of CITIES) {
      const countryId = countryIds.get(c.country);
      if (!countryId) {
        throw new Error(`City ${c.slug} references unknown country ${c.country}.`);
      }

      const values = {
        countryId,
        slug: c.slug,
        nameAr: c.nameAr,
        nameEn: c.nameEn,
        nameDe: c.nameDe,
        descriptionAr: c.descriptionAr,
        timezone: c.timezone,
        latitude: c.latitude,
        longitude: c.longitude,
        categories: c.categories,
        tagsAr: c.tagsAr,
        sortOrder: c.sortOrder,
      };

      // The unique index is partial (live rows only), so ON CONFLICT cannot see a
      // retired city. Looked up across every row instead, so a city staff retired is
      // not seeded again beside its own archived row.
      const existing = await tx.query.cities.findFirst({
        where: eq(schema.cities.slug, c.slug),
        columns: { id: true },
      });

      if (!existing) await tx.insert(schema.cities).values(values);
    }
    console.log(`  cities:              ${CITIES.length}`);

    // ── Landmark kinds ───────────────────────────────────────────────────────
    /*
      Before the landmarks, which reference them. These eight are the platform's starting
      taxonomy; once a kind exists its name and mark are the console's, so a mark redrawn there
      is not put back the way it shipped.
    */
    for (const k of LANDMARK_KINDS) {
      const existing = await tx.query.landmarkKinds.findFirst({
        where: eq(schema.landmarkKinds.code, k.code),
        columns: { id: true },
      });

      const values = {
        code: k.code,
        nameAr: k.nameAr,
        nameEn: k.nameEn,
        nameDe: k.nameDe,
        iconPaths: k.iconPaths,
        sortOrder: k.sortOrder,
      };

      if (!existing) await tx.insert(schema.landmarkKinds).values(values);
    }
    console.log(`  landmark kinds:      ${LANDMARK_KINDS.length}`);

    // ── Landmarks ────────────────────────────────────────────────────────────
    /*
      Keyed on (city, slug), the same shape as the partial unique index, across retired rows
      too. An existing landmark is left where staff put it: an airport gaining a second row at
      the seed's coordinates would show a guest two distances to one place, and moving it back
      would undo the correction.
    */
    for (const l of LANDMARKS) {
      const city = await tx.query.cities.findFirst({
        where: eq(schema.cities.slug, l.city),
        columns: { id: true },
      });
      /*
        A landmark whose city is not seeded is skipped rather than throwing. The cities
        list is the launch set and this list may run ahead of it; a seed that aborts
        half-way leaves the reference data in a state nobody can reason about.
      */
      if (!city) continue;

      const kind = await tx.query.landmarkKinds.findFirst({
        where: eq(schema.landmarkKinds.code, l.kind),
        columns: { id: true },
      });
      /* A landmark whose kind is not seeded is skipped, for the same reason its city is. */
      if (!kind) continue;

      const values = {
        cityId: city.id,
        kindId: kind.id,
        slug: l.slug,
        nameAr: l.nameAr,
        nameEn: l.nameEn,
        nameDe: l.nameDe,
        latitude: l.latitude,
        longitude: l.longitude,
        sortOrder: l.sortOrder,
      };

      const existing = await tx.query.landmarks.findFirst({
        where: and(
          eq(schema.landmarks.cityId, city.id),
          eq(schema.landmarks.slug, l.slug),
        ),
        columns: { id: true },
      });

      if (!existing) await tx.insert(schema.landmarks).values(values);
    }
    console.log(`  landmarks:           ${LANDMARKS.length}`);

    // ── Property types ───────────────────────────────────────────────────────
    for (const t of PROPERTY_TYPES) {
      await tx
        .insert(schema.propertyTypes)
        .values(t)
        .onConflictDoNothing({ target: schema.propertyTypes.code });
    }
    console.log(`  property types:      ${PROPERTY_TYPES.length}`);

    // ── Amenities ────────────────────────────────────────────────────────────
    for (const a of AMENITIES) {
      await tx
        .insert(schema.amenities)
        .values(a)
        .onConflictDoNothing({ target: schema.amenities.code });
    }
    console.log(`  amenities:           ${AMENITIES.length}`);

    // ── Cancellation policies ────────────────────────────────────────────────
    for (const p of CANCELLATION_POLICIES) {
      await tx
        .insert(schema.cancellationPolicies)
        .values(p)
        .onConflictDoNothing({ target: schema.cancellationPolicies.code });
    }
    console.log(`  policies:            ${CANCELLATION_POLICIES.length}`);

    // ── Partner types ────────────────────────────────────────────────────────
    for (const t of PARTNER_TYPES) {
      await tx
        .insert(schema.partnerTypes)
        .values(t)
        .onConflictDoNothing({ target: schema.partnerTypes.code });
    }
    console.log(`  partner types:       ${PARTNER_TYPES.length}`);

    // ── Settings ─────────────────────────────────────────────────────────────
    // Existing values are NOT overwritten: the admin may have tuned a commission
    // or SLA in production, and a deploy must never silently revert that.
    let inserted = 0;
    for (const s of SETTINGS) {
      const existing = await tx.query.settings.findFirst({
        where: sql`${schema.settings.key} = ${s.key} AND ${schema.settings.scope} = 'global'`,
        columns: { id: true },
      });

      if (!existing) {
        await tx.insert(schema.settings).values({
          key: s.key,
          scope: 'global',
          value: s.value,
          valueSchema: s.valueSchema,
          descriptionAr: s.descriptionAr,
          descriptionEn: s.descriptionEn,
        });
        inserted += 1;
      }
    }
    console.log(
      `  settings:            ${inserted} new, ${SETTINGS.length - inserted} left untouched`,
    );
  });
}

/**
 * Tells the operator the one thing the seed deliberately cannot do for them.
 *
 * Pricing REFUSES to quote without a `currency → SYP` rate, so a freshly seeded
 * deployment returns 503 on every quote until someone sets one. That is intentional
 * — the previous behaviour silently used a rate of 1 and understated every SYP
 * figure by four orders of magnitude — but it is invisible from the UI, which shows
 * only "temporarily unavailable".
 *
 * A rate is NOT seeded on purpose: a hardcoded number would be wrong the day after
 * it was written, and a wrong rate is worse than an absent one because it produces
 * plausible figures nobody questions. So the seed says so instead, at the moment the
 * operator is looking.
 */
export async function warnIfNoFxRate(db: Database): Promise<void> {
  const rows = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM fx_rates f
    JOIN currencies quote ON quote.id = f.quote_currency_id
    WHERE quote.code = 'SYP' AND f.effective_from <= now()
  `);

  if (Number(rows.rows[0]?.count ?? 0) > 0) return;

  console.log('');
  console.log('  ⚠  ACTION REQUIRED: no FX rate to SYP is configured.');
  console.log('     Bookings cannot be priced until one is set — every quote will');
  console.log('     return 503. Set one as a super admin:');
  console.log('');
  console.log('       POST /api/v1/admin/fx-rates');
  console.log('       {"currency":"USD","rate":"13000.00","source":"central_bank"}');
  console.log('');
  console.log('     No rate is seeded on purpose: a hardcoded one goes stale, and a');
  console.log('     wrong rate is worse than a missing one because it looks plausible.');
}
