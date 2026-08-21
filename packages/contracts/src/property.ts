import { z } from 'zod';

import { tripAttributeSchema } from './search.js';
import { ERROR } from './error-codes.js';

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
  .regex(/^-?\d{1,2}(\.\d{1,8})?$/, ERROR.VALIDATION_LATITUDE_FORMAT)
  .refine((v) => Math.abs(Number(v)) <= 90, ERROR.VALIDATION_LATITUDE_RANGE);

const longitudeSchema = z
  .string()
  .regex(/^-?\d{1,3}(\.\d{1,8})?$/, ERROR.VALIDATION_LONGITUDE_FORMAT)
  .refine((v) => Math.abs(Number(v)) <= 180, ERROR.VALIDATION_LONGITUDE_RANGE);

export const propertyCreateSchema = z
  .object({
    citySlug: z.string().trim().min(1).max(80),
    propertyTypeCode: z.string().trim().min(1).max(40),
    cancellationPolicyCode: z.string().trim().min(1).max(40),
    name: translatedText(160),
    description: translatedText(4000).partial({ ar: true }).optional(),
    address: z.string().trim().min(3).max(300),
    /**
     * «رقم الغرفة/الوحدة» — the room or unit this listing occupies (Bashar, 2026-08-19).
     *
     * Optional, and a LABEL rather than a number: real ones are `A-12`, `3ب`, `PH1` as often as
     * `101`. Nothing sorts or compares it, so a numeric type would only refuse valid answers.
     *
     * Capped at 20 because it is printed beside the listing name in عقاراتي and in the console's
     * registry — a value long enough to wrap is a value that breaks a row rather than describes a
     * room. `.trim()` so a field submitted with only spaces is empty, not a room called " ".
     */
    roomNumber: z.string().trim().max(20).optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    /**
     * §5.2 trip attributes ("صفات الرحلة"). Partner-declared and searchable.
     * Validated against the same enum the search filter uses, so a listing can
     * never be tagged with something no customer can search for.
     */
    attributes: z.array(tripAttributeSchema).max(10).default([]),
    /**
     * The units to open the listing with — §7.2's «عدد الوحدات» and «السعر لليلة».
     *
     * Optional, so the endpoint's existing callers are unaffected. Present because the handoff's
     * add-property form asks for both on the same screen, and a listing with no unit is not
     * bookable: a partner who filled in that form and got an empty listing would reasonably think
     * the form had failed.
     *
     * Identical units, named by index. A partner with genuinely different rooms edits them
     * afterwards; asking for six unit descriptions inside a create form is how the form stops
     * being filled in at all.
     */
    initialUnits: z
      .object({
        count: z.number().int().min(1).max(50),
        basePrice: z.number().min(0).max(1_000_000),
        maxGuests: z.number().int().min(1).max(50).default(2),
      })
      .strict()
      .optional(),
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
    message: ERROR.VALIDATION_NIGHTS_MIN_MAX,
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
    message: ERROR.VALIDATION_REJECTION_NOTES_REQUIRED,
    path: ['notes'],
  });

export type PropertyReviewInput = z.infer<typeof propertyReviewSchema>;

/**
 * A partner applying to join (SRS §8.1).
 *
 * Note what this CANNOT set, and why each absence is deliberate:
 *
 *  - `verification` — an applicant declaring themselves verified defeats §8.1
 *    entirely. It is forced to `pending` server-side.
 *  - `score`, `tier` — §8.5 ranking inputs. A partner setting their own score would
 *    be buying placement.
 *  - `role` — the account is created as `partner` in code, never from the payload.
 *
 * Three barriers rather than one: the field is absent from the schema, `.strict()`
 * rejects it if sent anyway, and the service never reads the payload for these
 * values. Mass assignment is the most common way a registration endpoint is broken.
 */

/**
 * The documents §8.1 requires before a partner can be verified.
 *
 * A closed list, not free text. The verification queue exists to answer "has this
 * partner proved who they are and that they may let this property?", and a kind
 * nobody recognises cannot contribute to that answer — it just sits in the queue
 * looking like progress.
 */
export const PARTNER_DOCUMENT_KINDS = [
  /** Passport or national ID of the signing person. */
  'identity',
  /** Commercial register extract for the legal entity. */
  'commercial_register',
  /** Title deed, or whatever shows the right to let the property. */
  'ownership_proof',
  /** Where the partner manages rather than owns. */
  'management_contract',
  /** Bank letter or similar, when finance asks for confirmation. */
  'bank_confirmation',
] as const;

export type PartnerDocumentKind = (typeof PARTNER_DOCUMENT_KINDS)[number];

export const partnerDocumentUploadSchema = z
  .object({ kind: z.enum(PARTNER_DOCUMENT_KINDS) })
  .strict();

export type PartnerDocumentUploadInput = z.infer<typeof partnerDocumentUploadSchema>;

/** A reviewer's decision on ONE document (§8.1, item 121). */
export const partnerDocumentReviewSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((v) => v.decision !== 'reject' || (v.notes?.length ?? 0) > 0, {
    /**
     * "Rejected" with no reason forces the partner to guess and re-upload blind,
     * which turns one review cycle into several.
     */
    message: ERROR.VALIDATION_DOCUMENT_REJECTION_NOTES_REQUIRED,
    path: ['notes'],
  });

export type PartnerDocumentReviewInput = z.infer<typeof partnerDocumentReviewSchema>;

/** Staff decision on a partner's onboarding (§8.1). */
export const partnerVerifySchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((v) => v.decision !== 'reject' || (v.notes?.length ?? 0) > 0, {
    message: ERROR.VALIDATION_REJECTION_NOTES_REQUIRED,
    path: ['notes'],
  });

export type PartnerVerifyInput = z.infer<typeof partnerVerifySchema>;

/**
 * Recording a sanctions screening (ADR 0002, §8.1).
 *
 * Note what is NOT here: the result. The platform runs the search itself against the
 * imported EU consolidated list, so a caller cannot assert an outcome it did not
 * obtain — which is what the previous shape allowed, making the legal obligation
 * satisfiable by a staff member simply saying they had checked.
 *
 * `matched` remains, as an OVERRIDE. Only a human can judge whether a fuzzy hit is
 * the same person, and the override is recorded alongside what the matcher said.
 */
export const sanctionsScreeningSchema = z
  .object({
    /** Overrides the automated reading, in either direction. Audited when it differs. */
    matched: z.boolean().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

export type SanctionsScreeningInput = z.infer<typeof sanctionsScreeningSchema>;

/**
 * The lists a snapshot can be imported AS (ADR 0002).
 *
 * `eu_consolidated` is the one SAFRA is legally obliged to screen against. `local_fixture` is a
 * hand-made file a developer imports to exercise the screening path locally, and screening never
 * looks for it — see `LOCAL_FIXTURE_SOURCE` in the API's `sanctions.service.ts` for why the
 * distinction is a SOURCE rather than a flag.
 *
 * Here in the contract rather than only in the service because it is the boundary that has to
 * refuse an unknown value: the source becomes a row somebody later reads as evidence of a
 * compliance check, so a caller must not be able to invent one.
 */
export const SANCTIONS_SOURCES = ['eu_consolidated', 'local_fixture'] as const;

export type SanctionsSource = (typeof SANCTIONS_SOURCES)[number];

/**
 * A body posted to `POST /admin/sanctions/import`.
 *
 * ## `source` has no default, on purpose
 *
 * Defaulting to the EU list would mean that FORGETTING the field labels a fixture as the genuine
 * article — which is the exact failure this field exists to prevent, arrived at by omission
 * instead of by intent. Making it required costs an operator one line in a runbook curl and makes
 * the mislabelling impossible rather than unlikely. Same reasoning as the console's `Field`
 * requiring `dir`: force the choice rather than let it be inherited by accident.
 *
 * ## The size floor
 *
 * A consolidated list is megabytes. A kilobyte of XML is a truncated download, a paste that lost
 * its tail, or an error page saved as a file — and importing any of those would REPLACE the list
 * every partner is screened against with almost nothing, silently.
 */
export const sanctionsImportSchema = z
  .object({
    xml: z.string().min(1000, ERROR.VALIDATION_SANCTIONS_BODY_TOO_SMALL),
    source: z.enum(SANCTIONS_SOURCES, {
      message: ERROR.VALIDATION_SANCTIONS_SOURCE,
    }),
  })
  .strict();

export type SanctionsImportInput = z.infer<typeof sanctionsImportSchema>;

/**
 * Reordering a property's images (§7.2 gallery).
 *
 * The FULL set of ids, in the order they should appear — not a pair of positions. A "move item 3
 * to position 1" API has to be applied against the client's idea of the current order, and two
 * tabs open on the same listing then produce an order neither person chose. Sending the whole
 * array makes the request self-describing: whatever it says, that is the order afterwards.
 *
 * The server checks the set matches the property's live images exactly, so a partial array cannot
 * quietly archive the images it omits.
 */
export const propertyImageOrderSchema = z
  .object({ imageIds: z.array(z.string().uuid()).min(1).max(30) })
  .strict();

export type PropertyImageOrderInput = z.infer<typeof propertyImageOrderSchema>;

/**
 * Alternative text for one image.
 *
 * Per locale, all optional, because a partner writing Arabic alt text should not be blocked on
 * also writing German. An image with no alt text renders `alt=""` — correct for decoration and
 * honest for a gallery, where the surrounding copy already names the property; a filename in the
 * alt attribute is worse than nothing for a screen-reader user.
 */
export const propertyImageAltSchema = z
  .object({
    ar: z.string().trim().max(300).optional(),
    en: z.string().trim().max(300).optional(),
    de: z.string().trim().max(300).optional(),
  })
  .strict();

export type PropertyImageAltInput = z.infer<typeof propertyImageAltSchema>;
