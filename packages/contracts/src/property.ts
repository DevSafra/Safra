import { z } from 'zod';

/**
 * Partner-facing property and unit management (SRS §8.3).
 *
 * The most important thing these schemas do is what they OMIT: there is no
 * `status` field anywhere. A partner cannot publish their own listing — §8.1 and
 * principle P-002 require SAFRA to verify documents, photos and address first.
 * Status transitions happen through dedicated endpoints with their own permissions,
 * so "trust before volume" is structural rather than a checklist item.
 *
 * Likewise absent: `rating`, `reviewsCount`, `recommendationScore`, `badges`,
 * `verifiedAt`. All are computed or awarded by SAFRA. A partner who could write
 * their own rating would make the entire ranking meaningless.
 */

const translatedText = (max: number) =>
  z.object({
    ar: z.string().trim().min(1).max(max),
    /** Arabic is the launch language; English and German may follow later (§1.4). */
    en: z.string().trim().min(1).max(max).optional(),
    de: z.string().trim().min(1).max(max).optional(),
  });

/** Decimal degrees as strings, so no precision is lost through a float. */
const latitudeSchema = z
  .string()
  .regex(/^-?\d{1,2}(\.\d{1,8})?$/, 'Latitude must be decimal degrees.')
  .refine((v) => Math.abs(Number(v)) <= 90, 'Latitude must be between -90 and 90.');

const longitudeSchema = z
  .string()
  .regex(/^-?\d{1,3}(\.\d{1,8})?$/, 'Longitude must be decimal degrees.')
  .refine((v) => Math.abs(Number(v)) <= 180, 'Longitude must be between -180 and 180.');

export const propertyCreateSchema = z
  .object({
    citySlug: z.string().trim().min(1).max(80),
    propertyTypeCode: z.string().trim().min(1).max(40),
    cancellationPolicyCode: z.string().trim().min(1).max(40),
    name: translatedText(160),
    description: translatedText(4000).partial({ ar: true }).optional(),
    address: z.string().trim().min(3).max(300),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
  })
  .strict();

export type PropertyCreateInput = z.infer<typeof propertyCreateSchema>;

/** Every field optional — PATCH semantics. Still no `status`. */
export const propertyUpdateSchema = propertyCreateSchema.partial().strict();
export type PropertyUpdateInput = z.infer<typeof propertyUpdateSchema>;

export const unitCreateSchema = z
  .object({
    name: translatedText(160),
    maxGuests: z.number().int().min(1).max(50),
    bedrooms: z.number().int().min(0).max(30).default(1),
    beds: z.number().int().min(1).max(50).default(1),
    bathrooms: z.number().int().min(0).max(30).default(1),
    basePrice: z.number().min(0).max(1_000_000),
    currencyCode: z.string().trim().length(3),
    minNights: z.number().int().min(1).max(365).default(1),
    maxNights: z.number().int().min(1).max(365).optional(),
    /**
     * Groups interchangeable units for display, e.g. "double_sea_view". NOT a
     * quantity — one row is one physical unit, which is what keeps the booking
     * exclusion constraint exact.
     */
    roomTypeCode: z.string().trim().min(1).max(60).optional(),
    unitLabel: z.string().trim().min(1).max(60).optional(),
    amenityCodes: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  })
  .strict()
  .refine((u) => u.maxNights === undefined || u.maxNights >= u.minNights, {
    message: 'Maximum nights cannot be lower than minimum nights.',
    path: ['maxNights'],
  });

export type UnitCreateInput = z.infer<typeof unitCreateSchema>;

export const unitUpdateSchema = z
  .object({
    name: translatedText(160).optional(),
    maxGuests: z.number().int().min(1).max(50).optional(),
    bedrooms: z.number().int().min(0).max(30).optional(),
    beds: z.number().int().min(1).max(50).optional(),
    bathrooms: z.number().int().min(0).max(30).optional(),
    basePrice: z.number().min(0).max(1_000_000).optional(),
    minNights: z.number().int().min(1).max(365).optional(),
    maxNights: z.union([z.number().int().min(1).max(365), z.null()]).optional(),
    roomTypeCode: z.union([z.string().trim().min(1).max(60), z.null()]).optional(),
    unitLabel: z.union([z.string().trim().min(1).max(60), z.null()]).optional(),
    amenityCodes: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
    /**
     * Taking a unit off sale entirely. Distinct from closing dates on the
     * calendar, and never a delete — P-003 forbids removing records.
     */
    isActive: z.boolean().optional(),
  })
  .strict();

export type UnitUpdateInput = z.infer<typeof unitUpdateSchema>;

/**
 * The status transitions a PARTNER may request. Approval and publication are not
 * here: those require staff permissions (§8.1).
 */
export const PARTNER_PROPERTY_TRANSITIONS = ['submit_for_review'] as const;
export const partnerPropertyTransitionSchema = z.enum(PARTNER_PROPERTY_TRANSITIONS);

/** Staff decisions on a submitted listing. */
export const propertyReviewSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    /** Mandatory on rejection: the partner must know what to fix. */
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((v) => v.decision !== 'reject' || (v.notes?.length ?? 0) > 0, {
    message: 'Rejection requires notes explaining what must change.',
    path: ['notes'],
  });

export type PropertyReviewInput = z.infer<typeof propertyReviewSchema>;
