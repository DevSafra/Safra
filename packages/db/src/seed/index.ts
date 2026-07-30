import { eq, sql } from 'drizzle-orm';

import { createDatabase, type Database } from '../client.js';
import * as schema from '../schema/index.js';
import {
  AMENITIES,
  CANCELLATION_POLICIES,
  CITIES,
  COUNTRIES,
  CURRENCIES,
  PARTNER_TYPES,
  PROPERTY_TYPES,
  SETTINGS,
} from './reference.js';

/**
 * Seeds reference data. Safe to run on every deploy.
 *
 * Every insert is an upsert on the row's natural key, so re-running updates
 * translations and flags without duplicating rows or resetting ids that bookings
 * already point at. There is no truncate anywhere in this file — principle P-003
 * forbids destructive operations, and a seed that wipes tables is exactly how a
 * production dataset gets lost.
 */
async function seed(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    // ── Currencies ───────────────────────────────────────────────────────────
    for (const c of CURRENCIES) {
      await tx
        .insert(schema.currencies)
        .values(c)
        .onConflictDoUpdate({
          target: schema.currencies.code,
          set: { nameAr: c.nameAr, nameEn: c.nameEn, nameDe: c.nameDe, symbol: c.symbol },
        });
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
        .onConflictDoUpdate({
          target: schema.countries.code,
          set: {
            nameAr: c.nameAr,
            nameEn: c.nameEn,
            nameDe: c.nameDe,
            displayCurrencyId,
            isLaunchMarket: c.isLaunchMarket,
          },
        });
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

      // The unique index is partial (live rows only), so the conflict target is
      // expressed as the same predicate rather than a plain column list.
      const existing = await tx.query.cities.findFirst({
        where: eq(schema.cities.slug, c.slug),
        columns: { id: true },
      });

      if (existing) {
        await tx
          .update(schema.cities)
          .set(values)
          .where(eq(schema.cities.id, existing.id));
      } else {
        await tx.insert(schema.cities).values(values);
      }
    }
    console.log(`  cities:              ${CITIES.length}`);

    // ── Property types ───────────────────────────────────────────────────────
    for (const t of PROPERTY_TYPES) {
      await tx
        .insert(schema.propertyTypes)
        .values(t)
        .onConflictDoUpdate({
          target: schema.propertyTypes.code,
          set: {
            nameAr: t.nameAr,
            nameEn: t.nameEn,
            nameDe: t.nameDe,
            hasMultipleUnits: t.hasMultipleUnits,
            glyph: t.glyph,
            sortOrder: t.sortOrder,
          },
        });
    }
    console.log(`  property types:      ${PROPERTY_TYPES.length}`);

    // ── Amenities ────────────────────────────────────────────────────────────
    for (const a of AMENITIES) {
      await tx
        .insert(schema.amenities)
        .values(a)
        .onConflictDoUpdate({
          target: schema.amenities.code,
          set: {
            nameAr: a.nameAr,
            nameEn: a.nameEn,
            nameDe: a.nameDe,
            category: a.category,
            isFilterable: a.isFilterable,
            sortOrder: a.sortOrder,
          },
        });
    }
    console.log(`  amenities:           ${AMENITIES.length}`);

    // ── Cancellation policies ────────────────────────────────────────────────
    for (const p of CANCELLATION_POLICIES) {
      await tx
        .insert(schema.cancellationPolicies)
        .values(p)
        .onConflictDoUpdate({
          target: schema.cancellationPolicies.code,
          set: {
            nameAr: p.nameAr,
            nameEn: p.nameEn,
            nameDe: p.nameDe,
            descriptionAr: p.descriptionAr,
            descriptionEn: p.descriptionEn,
            descriptionDe: p.descriptionDe,
            tiers: p.tiers,
            minRefundPercent: p.minRefundPercent,
          },
        });
    }
    console.log(`  policies:            ${CANCELLATION_POLICIES.length}`);

    // ── Partner types ────────────────────────────────────────────────────────
    for (const t of PARTNER_TYPES) {
      await tx
        .insert(schema.partnerTypes)
        .values(t)
        .onConflictDoUpdate({
          target: schema.partnerTypes.code,
          set: {
            nameAr: t.nameAr,
            nameEn: t.nameEn,
            nameDe: t.nameDe,
            capabilities: t.capabilities,
          },
        });
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
async function warnIfNoFxRate(db: Database): Promise<void> {
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

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required.');
  }

  console.log('Seeding reference data...');
  const db = createDatabase(connectionString, 1);

  try {
    await seed(db);
    await warnIfNoFxRate(db);
    console.log('Seed complete.');
  } finally {
    // The pg Pool keeps the process alive otherwise.
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
