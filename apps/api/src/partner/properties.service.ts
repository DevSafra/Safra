import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  ERROR,
  PERMISSIONS as P,
  type PropertyCreateInput,
  type PropertyUpdateInput,
  type UnitCreateInput,
  type UnitUpdateInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { requirePartnerId } from '../rbac/ownership.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';

/**
 * A partner may edit a listing only while it is theirs AND still editable.
 *
 * Once published, changing the address or city would invalidate the verification
 * SAFRA performed (§8.1), so structural edits are confined to pre-publication
 * states. Prices and calendar remain editable at any time — those are the
 * partner's ongoing responsibility (P-006).
 */
const STRUCTURALLY_EDITABLE = ['draft', 'pending_review', 'rejected'] as const;

@Injectable()
export class PropertiesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async listOwn(claims: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);

    return this.db.query.properties.findMany({
      where: and(
        eq(schema.properties.partnerId, partnerId),
        isNull(schema.properties.deletedAt),
      ),
      columns: {
        reference: true,
        slug: true,
        nameAr: true,
        nameEn: true,
        status: true,
        rating: true,
        reviewsCount: true,
        recommendationScore: true,
        verifiedAt: true,
        createdAt: true,
      },
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    });
  }

  async create(claims: AccessTokenClaims | undefined, input: PropertyCreateInput) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);

    const [city, type, policy] = await Promise.all([
      this.db.query.cities.findFirst({
        where: and(
          eq(schema.cities.slug, input.citySlug),
          isNull(schema.cities.deletedAt),
        ),
        columns: { id: true },
      }),
      this.db.query.propertyTypes.findFirst({
        where: eq(schema.propertyTypes.code, input.propertyTypeCode),
        columns: { id: true },
      }),
      this.db.query.cancellationPolicies.findFirst({
        where: eq(schema.cancellationPolicies.code, input.cancellationPolicyCode),
        columns: { id: true },
      }),
    ]);

    if (!city) throw badRequest(ERROR.GEO_CITY_UNKNOWN);
    if (!type) throw badRequest(ERROR.PROPERTY_TYPE_UNKNOWN);
    if (!policy) {
      // §7.4: partners pick from SAFRA-approved policies; they cannot invent terms.
      throw badRequest(ERROR.PROPERTY_CANCELLATION_POLICY_UNKNOWN);
    }

    const slug = await this.uniqueSlug(input.name.ar, input.name.en);

    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.properties)
        .values({
          partnerId,
          cityId: city.id,
          propertyTypeId: type.id,
          cancellationPolicyId: policy.id,
          slug,
          nameAr: input.name.ar,
          nameEn: input.name.en ?? input.name.ar,
          nameDe: input.name.de ?? input.name.ar,
          descriptionAr: input.description?.ar ?? null,
          descriptionEn: input.description?.en ?? null,
          descriptionDe: input.description?.de ?? null,
          address: input.address,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          attributes: input.attributes,
          // Forced. Never taken from input — the schema has no status field, and
          // this is the second barrier (§8.1 / P-002).
          status: 'draft',
        })
        .returning({ reference: schema.properties.reference, id: schema.properties.id });

      if (!row) throw new Error('Property insert returned no row.');

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'property.created',
          subjectType: 'property',
          subjectId: row.id,
          after: { reference: row.reference, slug, status: 'draft' },
        },
        tx as unknown as Database,
      );

      return row;
    });

    return { reference: created.reference, slug, status: 'draft' as const };
  }

  async update(
    claims: AccessTokenClaims | undefined,
    reference: string,
    input: PropertyUpdateInput,
  ) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);
    const property = await this.findOwned(partnerId, reference);

    if (
      !STRUCTURALLY_EDITABLE.includes(
        property.status as (typeof STRUCTURALLY_EDITABLE)[number],
      )
    ) {
      throw conflict(ERROR.PROPERTY_NOT_STRUCTURALLY_EDITABLE);
    }

    const patch: Record<string, unknown> = {};

    if (input.name) {
      patch['nameAr'] = input.name.ar;
      if (input.name.en) patch['nameEn'] = input.name.en;
      if (input.name.de) patch['nameDe'] = input.name.de;
    }
    if (input.description) {
      if (input.description.ar) patch['descriptionAr'] = input.description.ar;
      if (input.description.en) patch['descriptionEn'] = input.description.en;
      if (input.description.de) patch['descriptionDe'] = input.description.de;
    }
    if (input.address !== undefined) patch['address'] = input.address;
    if (input.attributes !== undefined) patch['attributes'] = input.attributes;
    if (input.latitude !== undefined) patch['latitude'] = input.latitude;
    if (input.longitude !== undefined) patch['longitude'] = input.longitude;

    if (input.citySlug) {
      const city = await this.db.query.cities.findFirst({
        where: and(
          eq(schema.cities.slug, input.citySlug),
          isNull(schema.cities.deletedAt),
        ),
        columns: { id: true },
      });
      if (!city) throw badRequest(ERROR.GEO_CITY_UNKNOWN);
      patch['cityId'] = city.id;
    }

    if (input.cancellationPolicyCode) {
      const policy = await this.db.query.cancellationPolicies.findFirst({
        where: eq(schema.cancellationPolicies.code, input.cancellationPolicyCode),
        columns: { id: true },
      });
      if (!policy) {
        throw badRequest(ERROR.PROPERTY_CANCELLATION_POLICY_UNKNOWN);
      }
      patch['cancellationPolicyId'] = policy.id;
    }

    if (Object.keys(patch).length === 0) {
      throw badRequest(ERROR.SETTING_NO_UPDATABLE_FIELDS);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.properties)
        .set(patch)
        .where(eq(schema.properties.id, property.id));

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'property.updated',
          subjectType: 'property',
          subjectId: property.id,
          after: patch,
        },
        tx as unknown as Database,
      );
    });

    return { reference, updated: Object.keys(patch) };
  }

  /**
   * Partner submits a draft for SAFRA review. This is as far as a partner can move
   * a listing toward being live — approval is a staff action (§8.1).
   */
  async submitForReview(claims: AccessTokenClaims | undefined, reference: string) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);
    const property = await this.findOwned(partnerId, reference);

    if (property.status !== 'draft' && property.status !== 'rejected') {
      throw conflict(ERROR.PROPERTY_NOT_SUBMITTABLE);
    }

    // A listing with no bookable unit cannot be reviewed meaningfully.
    const units = await this.db.query.units.findMany({
      where: and(
        eq(schema.units.propertyId, property.id),
        isNull(schema.units.deletedAt),
      ),
      columns: { id: true },
    });

    if (units.length === 0) {
      throw badRequest(ERROR.PROPERTY_UNIT_REQUIRED);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.properties)
        .set({ status: 'pending_review' })
        .where(eq(schema.properties.id, property.id));

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'property.submitted_for_review',
          subjectType: 'property',
          subjectId: property.id,
          before: { status: property.status },
          after: { status: 'pending_review' },
        },
        tx as unknown as Database,
      );

      await tx.insert(schema.timelineEvents).values({
        subjectType: 'property',
        subjectId: property.id,
        eventType: 'property.submitted_for_review',
        actorType: 'partner',
        actorUserId: claims?.sub ?? null,
      });
    });

    return { reference, status: 'pending_review' as const };
  }

  // ── Units ─────────────────────────────────────────────────────────────────

  async addUnit(
    claims: AccessTokenClaims | undefined,
    propertyReference: string,
    input: UnitCreateInput,
  ) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);
    const property = await this.findOwned(partnerId, propertyReference);

    const currency = await this.db.query.currencies.findFirst({
      where: eq(schema.currencies.code, input.currencyCode.toUpperCase()),
      columns: { id: true },
    });

    if (!currency) throw badRequest(ERROR.GEO_CURRENCY_UNKNOWN);

    const amenityIds = await this.resolveAmenityIds(input.amenityCodes);

    const unitId = await this.db.transaction(async (tx) => {
      const [unit] = await tx
        .insert(schema.units)
        .values({
          propertyId: property.id,
          nameAr: input.name.ar,
          nameEn: input.name.en ?? input.name.ar,
          nameDe: input.name.de ?? input.name.ar,
          maxGuests: input.maxGuests,
          bedrooms: input.bedrooms,
          beds: input.beds,
          bathrooms: input.bathrooms,
          basePrice: input.basePrice.toFixed(2),
          currencyId: currency.id,
          minNights: input.minNights,
          maxNights: input.maxNights ?? null,
          roomTypeCode: input.roomTypeCode ?? null,
          unitLabel: input.unitLabel ?? null,
        })
        .returning({ id: schema.units.id });

      if (!unit) throw new Error('Unit insert returned no row.');

      if (amenityIds.length > 0) {
        await tx
          .insert(schema.unitAmenities)
          .values(amenityIds.map((amenityId) => ({ unitId: unit.id, amenityId })));
      }

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'unit.created',
          subjectType: 'unit',
          subjectId: unit.id,
          after: {
            propertyReference,
            maxGuests: input.maxGuests,
            basePrice: input.basePrice,
          },
        },
        tx as unknown as Database,
      );

      return unit.id;
    });

    return { unitId, propertyReference };
  }

  async updateUnit(
    claims: AccessTokenClaims | undefined,
    unitId: string,
    input: UnitUpdateInput,
  ) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);
    await this.assertOwnsUnit(partnerId, unitId);

    const patch: Record<string, unknown> = {};

    if (input.name) {
      patch['nameAr'] = input.name.ar;
      if (input.name.en) patch['nameEn'] = input.name.en;
      if (input.name.de) patch['nameDe'] = input.name.de;
    }
    if (input.maxGuests !== undefined) patch['maxGuests'] = input.maxGuests;
    if (input.bedrooms !== undefined) patch['bedrooms'] = input.bedrooms;
    if (input.beds !== undefined) patch['beds'] = input.beds;
    if (input.bathrooms !== undefined) patch['bathrooms'] = input.bathrooms;
    // Price is stored as a fixed-scale string; never a float (rule 1).
    if (input.basePrice !== undefined) patch['basePrice'] = input.basePrice.toFixed(2);
    if (input.minNights !== undefined) patch['minNights'] = input.minNights;
    if (input.maxNights !== undefined) patch['maxNights'] = input.maxNights;
    if (input.roomTypeCode !== undefined) patch['roomTypeCode'] = input.roomTypeCode;
    if (input.unitLabel !== undefined) patch['unitLabel'] = input.unitLabel;
    if (input.isActive !== undefined) patch['isActive'] = input.isActive;

    if (Object.keys(patch).length === 0 && input.amenityCodes === undefined) {
      throw badRequest(ERROR.SETTING_NO_UPDATABLE_FIELDS);
    }

    await this.db.transaction(async (tx) => {
      if (Object.keys(patch).length > 0) {
        await tx.update(schema.units).set(patch).where(eq(schema.units.id, unitId));
      }

      if (input.amenityCodes !== undefined) {
        const amenityIds = await this.resolveAmenityIds(input.amenityCodes);
        // Amenities are a set: replace wholesale rather than diffing, so the
        // result always matches exactly what the partner submitted.
        await tx
          .delete(schema.unitAmenities)
          .where(eq(schema.unitAmenities.unitId, unitId));
        if (amenityIds.length > 0) {
          await tx
            .insert(schema.unitAmenities)
            .values(amenityIds.map((amenityId) => ({ unitId, amenityId })));
        }
      }

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'unit.updated',
          subjectType: 'unit',
          subjectId: unitId,
          after: { ...patch, amenityCodes: input.amenityCodes },
        },
        tx as unknown as Database,
      );
    });

    return { unitId, updated: Object.keys(patch) };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Loads a property the caller owns, or 404s.
   *
   * Ownership is part of the WHERE clause, and a property belonging to a different
   * partner is reported as "not found" rather than "forbidden" — a 403 would
   * confirm that reference exists, and references are sequential.
   */
  private async findOwned(partnerId: string, reference: string) {
    const property = await this.db.query.properties.findFirst({
      where: and(
        eq(schema.properties.reference, reference),
        eq(schema.properties.partnerId, partnerId),
        isNull(schema.properties.deletedAt),
      ),
      columns: { id: true, status: true, slug: true },
    });

    if (!property) throw notFound(ERROR.PROPERTY_NOT_FOUND);

    return property;
  }

  /** Units are owned transitively, through their property. */
  private async assertOwnsUnit(partnerId: string, unitId: string): Promise<void> {
    const rows = await this.db
      .select({ id: schema.units.id })
      .from(schema.units)
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .where(
        and(
          eq(schema.units.id, unitId),
          eq(schema.properties.partnerId, partnerId),
          isNull(schema.units.deletedAt),
          isNull(schema.properties.deletedAt),
        ),
      )
      .limit(1);

    if (rows.length === 0) throw notFound(ERROR.UNIT_NOT_FOUND);
  }

  private async resolveAmenityIds(codes: string[]): Promise<string[]> {
    if (codes.length === 0) return [];

    const found = await this.db.query.amenities.findMany({
      where: (a, { inArray }) => inArray(a.code, codes),
      columns: { id: true, code: true },
    });

    const missing = codes.filter((c) => !found.some((f) => f.code === c));
    if (missing.length > 0) {
      throw badRequest(ERROR.PROPERTY_AMENITIES_UNKNOWN);
    }

    return found.map((f) => f.id);
  }

  /**
   * Slugs feed the SEO property URL, so they are derived from the name and made
   * unique with a numeric suffix. Arabic names transliterate poorly, so an English
   * name is preferred when present, with a reference-based fallback rather than a
   * mangled slug.
   */
  private async uniqueSlug(nameAr: string, nameEn?: string): Promise<string> {
    const base =
      slugify(nameEn ?? '') || slugify(nameAr) || `property-${Date.now().toString(36)}`;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;

      const clash = await this.db.query.properties.findFirst({
        where: and(
          eq(schema.properties.slug, candidate),
          isNull(schema.properties.deletedAt),
        ),
        columns: { id: true },
      });

      if (!clash) return candidate;
    }

    throw conflict(ERROR.PROPERTY_SLUG_NOT_DERIVABLE);
  }
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      // Latin letters, digits and separators only. Arabic script is dropped here by
      // design; the Arabic name still drives the page title and content.
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 70)
      .replace(/^-|-$/g, '')
  );
}
