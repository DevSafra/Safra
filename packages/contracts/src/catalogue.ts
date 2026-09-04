import { z } from 'zod';

import { ERROR } from './error-codes.js';

/**
 * كتالوج المنصّة — the three reference sets a business manages, not a developer (Bashar,
 * 2026-09-04).
 *
 * ## Why they are writes at all
 *
 * `amenities`, `cancellation_policies` and `partner_types` are read across the whole platform —
 * the search sidebar, the property page, the partner's listing form, the application form, refund
 * arithmetic — and were **written nowhere**. Adding «EV charger», renaming a policy, or retiring a
 * partner type meant direct SQL against production. `amenities`' own schema comment has said
 * «Admin-managed so a new filter (§5.5) needs no deploy» since it was written; nothing made it so.
 *
 * In Bashar's words: *"I do not want normal business operations to depend on direct SQL or
 * migrations where an administrator should reasonably be able to manage the data through the
 * platform."*
 *
 * ## `code` is chosen once and never edited
 *
 * The same rule the city categories follow. A code is what the seed, the contracts, the customer
 * URLs and every existing row key on; renaming it would orphan translations and links while
 * looking like a rename. The NAMES are what a person changes.
 *
 * ## Retiring and deleting are different acts, and both are offered
 *
 * `isActive` stops a row being OFFERED — it leaves the pickers, and everything already carrying it
 * keeps working. That is the right answer for a policy a thousand bookings snapshot, or an amenity
 * ten thousand units declare. Deletion is the right answer for a row added by mistake, and it is
 * refused the moment anything references it — the refusal names the count, so a reader learns why
 * rather than meeting a foreign-key error.
 *
 * ## What is deliberately NOT editable
 *
 * **`partner_types.capabilities`.** The column exists and nothing in the application reads it. An
 * editor for it would be a control that changes nothing, which reads as coverage and is worse than
 * its absence — see `docs/FUTURE-WORK.md`. If it gains a consumer, it gains an editor then.
 */

/** A code: Latin, lowercase, hyphenated. The same shape a slug takes, for the same reasons. */
const code = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, ERROR.CATALOGUE_CODE_FORMAT);

const name = z.string().trim().min(1).max(120);
const description = z.string().trim().min(1).max(600);

/**
 * Which group an amenity sits in on the search sidebar.
 *
 * A closed set rather than free text: the sidebar renders one heading per group from its own
 * catalogue, so a typo would produce a group with no heading — a row of amenities under nothing.
 */
export const AMENITY_CATEGORIES = ['facilities', 'rules', 'accessibility'] as const;

export type AmenityCategory = (typeof AMENITY_CATEGORIES)[number];

export const amenityCreateSchema = z
  .object({
    code,
    nameAr: name,
    nameEn: name,
    nameDe: name,
    category: z.enum(AMENITY_CATEGORIES).default('facilities'),
    /** Whether it appears in the SEARCH FILTER — see the schema note on `is_active` beside it. */
    isFilterable: z.boolean().default(true),
  })
  .strict();

export const amenityUpdateSchema = z
  .object({
    nameAr: name.optional(),
    nameEn: name.optional(),
    nameDe: name.optional(),
    category: z.enum(AMENITY_CATEGORIES).optional(),
    isFilterable: z.boolean().optional(),
    /** Retired: it leaves the partner's listing form and keeps every link it already has. */
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
  })
  .strict();

/**
 * One step of a cancellation ladder: cancel at least this many hours ahead, get this much back.
 *
 * `refund.service.ts` sorts descending by `hoursBeforeCheckIn` and takes the FIRST match, so the
 * tiers need not be given in order and overlapping ones resolve to the most generous applicable
 * step. Zero hours is the catch-all — a policy without one refunds nothing to a late canceller,
 * which is a real choice and not a mistake.
 */
export const cancellationTierSchema = z
  .object({
    hoursBeforeCheckIn: z.number().int().min(0).max(8760),
    refundPercent: z.number().int().min(0).max(100),
  })
  .strict();

export type CancellationTier = z.infer<typeof cancellationTierSchema>;

/**
 * At most eight steps, and at least one.
 *
 * A ladder nobody can hold in their head is one nobody can explain to a guest disputing a refund,
 * and the customer-facing policy text has to describe it in a sentence. Eight is generous.
 */
const tiers = z.array(cancellationTierSchema).min(1).max(8);

export const cancellationPolicyCreateSchema = z
  .object({
    code,
    nameAr: name,
    nameEn: name,
    nameDe: name,
    descriptionAr: description,
    descriptionEn: description,
    descriptionDe: description,
    tiers,
    /**
     * The floor no tier may take a refund below, applied after the ladder.
     *
     * `refund.service.ts` reads it from the booking's SNAPSHOT, so changing it here moves future
     * bookings only — which is the point of snapshotting and must be said on the screen.
     */
    minRefundPercent: z.number().int().min(0).max(100).default(50),
  })
  .strict();

export const cancellationPolicyUpdateSchema = z
  .object({
    nameAr: name.optional(),
    nameEn: name.optional(),
    nameDe: name.optional(),
    descriptionAr: description.optional(),
    descriptionEn: description.optional(),
    descriptionDe: description.optional(),
    tiers: tiers.optional(),
    minRefundPercent: z.number().int().min(0).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const partnerTypeCreateSchema = z
  .object({
    code,
    nameAr: name,
    nameEn: name,
    nameDe: name,
  })
  .strict();

export const partnerTypeUpdateSchema = z
  .object({
    nameAr: name.optional(),
    nameEn: name.optional(),
    nameDe: name.optional(),
    /** A retired type leaves the application form; partners already on it are untouched. */
    isActive: z.boolean().optional(),
  })
  .strict();

export type AmenityCreateInput = z.infer<typeof amenityCreateSchema>;
export type AmenityUpdateInput = z.infer<typeof amenityUpdateSchema>;
export type CancellationPolicyCreateInput = z.infer<
  typeof cancellationPolicyCreateSchema
>;
export type CancellationPolicyUpdateInput = z.infer<
  typeof cancellationPolicyUpdateSchema
>;
export type PartnerTypeCreateInput = z.infer<typeof partnerTypeCreateSchema>;
export type PartnerTypeUpdateInput = z.infer<typeof partnerTypeUpdateSchema>;
