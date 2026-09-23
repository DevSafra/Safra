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

/**
 * How long a listing's headline may be.
 *
 * One line beside a 4,000-character description. 120 is roughly two lines of Arabic on a phone and
 * one on a laptop — long enough for «فندق خمس نجوم في قلب دمشق القديمة» and short enough that it
 * cannot quietly become a second description.
 */
export const PROPERTY_HEADLINE_MAX = 120;

/**
 * Text per language, where an empty string is how a partner REMOVES it.
 *
 * The difference from `translatedText` is one missing `.min(1)`, and it is the whole point.
 *
 * With `.min(1)`, `''` is a validation error, so the only way a form can say "nothing" is to omit
 * the key — and the update path reads an omitted key as «leave it alone». That made clearing
 * impossible: a partner who emptied the English description saved successfully and found the old
 * copy still there, with nothing to tell them why. Reported as a consequence of building the
 * headline (2026-09-13), fixed for both on 2026-09-14.
 *
 * Here a key that is SENT is honoured exactly, `''` included, and the service maps `''` to NULL.
 * `.partial()` so a form may still send one language and leave the others untouched.
 *
 * `name` deliberately keeps `translatedText`: a listing with no name is not a listing, so there
 * the absence of an empty-string spelling is the rule rather than a gap in it.
 */
const clearableText = (max: number) =>
  z
    .object({
      ar: z.string().trim().max(max),
      en: z.string().trim().max(max),
      de: z.string().trim().max(max),
    })
    .partial();

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

/**
 * Every field a listing carries, with no cross-field rule applied.
 *
 * Named so `propertyUpdateSchema` can still `.omit().partial()` it: `propertyCreateSchema` is a
 * REFINED schema now — «a hotel must declare a classification, nothing else may» is a rule about
 * two fields at once — and a refined schema has no `.partial()`. Deriving the patch shape from the
 * effect rather than from the object is the mistake this split exists to prevent.
 */
/**
 * The property types that carry an official star classification (Bashar, 2026-09-04).
 *
 * A WRITTEN list of type codes, not a flag on `property_types`. The flag would be the obvious
 * design and it is the wrong one here: `property_types` is operator-editable data, so a column
 * saying «this type is star-rated» would let somebody tick it for «مخيم» from a settings screen
 * and give camps a hotel classification — a product decision made by accident, in a table.
 *
 * A list means adding «boutique hotel» to the classification is a code change somebody reviews,
 * which is what a decision of this kind should cost.
 *
 * `hotel` is the code, and codes are the stable identifier — the same reasoning
 * `CUSTOMER_FACING_METHODS` records. Renaming the Arabic label does not move a listing out of the
 * scheme; deleting the type would, and nothing can delete a type that listings reference.
 */
export const STAR_RATED_PROPERTY_TYPES = ['hotel'] as const;

/** Whether this property type declares a star classification at all. */
export function usesStarRating(propertyTypeCode: string): boolean {
  return (STAR_RATED_PROPERTY_TYPES as readonly string[]).includes(propertyTypeCode);
}

const propertyBaseSchema = z
  .object({
    citySlug: z.string().trim().min(1).max(80),
    propertyTypeCode: z.string().trim().min(1).max(40),
    cancellationPolicyCode: z.string().trim().min(1).max(40),
    name: translatedText(160),
    /* Clearable — see `clearableText`. Nothing requires a listing to carry a description. */
    description: clearableText(4000).optional(),
    /**
     * The listing's own one line, shown above the description (Bashar, 2026-09-13).
     *
     * NOT `translatedText`, and the difference is deliberate: this one is CLEARABLE.
     *
     * `translatedText` puts `.min(1)` on every language, so an empty string is a validation error
     * and the only way to send "nothing" is to omit the key — which the update path reads as «leave
     * it alone». That is why an emptied English description cannot currently be cleared through the
     * editor: the form omits it and the service keeps the old value. A description is written once
     * and lived with, so nobody has hit it. A headline is decoration a partner adds and removes, so
     * the same shape would be a defect on its first day.
     *
     * Here `''` is VALID and MEANS cleared, and the service maps it to NULL. Capped short — the
     * point is one line above a paragraph; a headline that wraps to four is a second description.
     */
    headline: clearableText(PROPERTY_HEADLINE_MAX).optional(),
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
    /**
     * The official star CLASSIFICATION, 1 to 5 — for a HOTEL (Bashar, 2026-09-04).
     *
     * Optional HERE and required by the refinement below, because whether it is required depends
     * on another field in the same object. `.optional()` alone would let a hotel be created without
     * one; a bare `.min(1)` would demand one from a villa. Only a cross-field rule expresses
     * «required for hotels, absent for everything else», and it lives in one place so the three
     * forms that send this cannot disagree about it.
     *
     * The column stays nullable regardless: 2,703 listings predate the field, and now every
     * non-hotel listing is legitimately null forever.
     *
     * `z.coerce` because it arrives from a `<select>` as a string on every form that sends it.
     * Without it the schema refuses "4" and the partner reads a validation error about a field
     * they filled in correctly.
     */
    starRating: z.coerce
      .number({ message: ERROR.VALIDATION_STAR_RATING })
      .int(ERROR.VALIDATION_STAR_RATING)
      .min(1, ERROR.VALIDATION_STAR_RATING)
      .max(5, ERROR.VALIDATION_STAR_RATING)
      .optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    /**
     * §5.2 trip attributes ("صفات الرحلة"). Partner-declared and searchable.
     * Validated against the same enum the search filter uses, so a listing can
     * never be tagged with something no customer can search for.
     */
    attributes: z.array(tripAttributeSchema).max(10).default([]),
    /**
     * What the BUILDING offers, as opposed to what a room does (Bashar, 2026-09-06).
     *
     * The same catalogue `unitCreateSchema.amenityCodes` draws on, attached one level up. A pool,
     * a lift, parking and a reception desk are facts about the property; a kettle and a balcony are
     * facts about the room. Before this the partner had only the room level, so a hotel's pool had
     * to be repeated on every room — and a guest reading it could not tell whether it was theirs.
     *
     * Honoured on BOTH create and update, deliberately: the note on `initialUnits` below records
     * what happens when a schema advertises a field the service discards, and this is that field's
     * shape exactly.
     */
    amenityCodes: z.array(z.string().trim().min(1).max(40)).max(60).optional(),
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

export const propertyCreateSchema = propertyBaseSchema
  /*
    ── Star classification is a HOTEL classification (Bashar, 2026-09-04) ──────────────────────

    «Other accommodation types such as apartments, villas, chalets, homes, camps and similar
    property types should not use the hotel star-classification system. For non-hotel accommodation
    types, the classification should simply be absent rather than forcing an artificial star
    value.»

    Both directions are refused, and the second matters as much as the first: a villa that ARRIVES
    with `starRating: 5` is rejected rather than quietly stripped. Silently dropping a field a
    caller sent is how a partner comes to believe they declared something they did not, and how a
    future client ships a form that appears to work.

    The error is attached to `starRating` in both cases, so a form highlights the field the person
    can actually do something about rather than the type they chose on purpose.
  */
  .superRefine((value, context) => {
    const hotel = usesStarRating(value.propertyTypeCode);

    if (hotel && value.starRating === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['starRating'],
        message: ERROR.VALIDATION_STAR_RATING_REQUIRED,
      });
    }

    if (!hotel && value.starRating !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['starRating'],
        message: ERROR.VALIDATION_STAR_RATING_NOT_A_HOTEL,
      });
    }
  });

/**
 * Staff setting or correcting a property's star classification (Bashar, 2026-09-04).
 *
 * ## Why a dedicated endpoint rather than a general property editor
 *
 * The console cannot edit a property at all — it approves and rejects. That is deliberate: §8.1
 * says SAFRA verified the address, the photographs and the documents AGAINST EACH OTHER, and a
 * console that could quietly rewrite a listing's address would invalidate its own verification.
 * None of that argument applies to the classification, which is a single bounded number a reviewer
 * checks against the partner's papers.
 *
 * It is needed rather than convenient. 2,703 listings predate the field and 2,016 of them are
 * PUBLISHED, which the partner may no longer edit — so without this, «the Super Admin must be able
 * to see the star rating for every property, including properties already published» would show
 * an empty column for the entire existing catalogue, permanently. It is also the only path for a
 * hotel that is re-classified after it goes live.
 *
 * One field, so the blast radius is one field.
 */
export const propertyStarRatingSchema = z
  .object({
    starRating: z.coerce
      .number({ message: ERROR.VALIDATION_STAR_RATING })
      .int(ERROR.VALIDATION_STAR_RATING)
      .min(1, ERROR.VALIDATION_STAR_RATING)
      .max(5, ERROR.VALIDATION_STAR_RATING),
  })
  .strict();

export type PropertyStarRatingInput = z.infer<typeof propertyStarRatingSchema>;

export type PropertyCreateInput = z.infer<typeof propertyCreateSchema>;

/**
 * Every field optional — PATCH semantics. Still no `status`, and no `initialUnits`.
 *
 * `initialUnits` is dropped rather than inherited from `.partial()`. `PropertiesService.update`
 * never read it, so the contract advertised a field the code silently discarded — a partner who
 * sent it got a 200 and no units. A schema that accepts what nothing honours is a promise the
 * server does not keep, and the shape it invites is somebody later "fixing" the omission by
 * wiring it up on a route with no verification check, which is the hole this pairs with on
 * `create`. Units are added through `POST properties/:reference/units`, which is guarded.
 */
export const propertyUpdateSchema = propertyBaseSchema
  .omit({ initialUnits: true })
  .partial()
  /*
    A PATCH schema may not carry DEFAULTS, and `.partial()` does not remove them.

    `attributes` is `.default([])` on the base schema, which is right for a create — a listing with
    no attributes is an empty list, not a missing one. On a patch it is a trap: zod fills the field
    in whether or not the caller sent it, so parsing `{ amenityCodes: [...] }` yields
    `{ amenityCodes: [...], attributes: [] }`, and `PropertiesService.update` writes `attributes`
    whenever it is defined. Every partner PATCH was therefore CLEARING the listing's trip
    attributes — correcting an address wiped «جبلي» and «عائلي» with it.

    The default is applied at every parse boundary, so stripping it in the route proxy was not
    enough: the API's own validation pipe put it straight back. It has to be absent from the schema
    a patch is judged by, which is this one.

    Found on 2026-09-06 by an amenity-only patch answering 409 property.not_structurally_editable —
    the refusal named a field the caller had never sent.
  */
  .extend({
    attributes: z.array(tripAttributeSchema).max(10).optional(),
    /*
      NULLABLE on a patch, and only on a patch.

      «A listing has no location» is a state the database has always allowed and 1,950 of
      2,017 listings were in — so a partner who opens the map picker and decides not to
      publish a location must be able to say so. `undefined` cannot: on a PATCH it means
      «leave this alone», which is a different sentence.

      Not on the base schema, because a CREATE has nothing to unset. Widening both would let
      `{latitude: null}` arrive at creation, which is `{}` written the long way.

      `PropertiesService.update` refuses this on a published listing — clearing a verified
      location is a change, not the gap-completion the narrow exception allows. The contract
      states what is EXPRESSIBLE; the service states who may do it.
    */
    latitude: latitudeSchema.nullable().optional(),
    longitude: longitudeSchema.nullable().optional(),
  })
  .strict()
  /*
    The half of the hotel rule a PATCH can decide on its own.

    When a patch names both the type and the classification, the pair can be judged here. When it
    names only one, the answer depends on the STORED type — which no schema can see — so
    `PropertiesService.update` finishes the job. Both halves exist because a rule enforced only in
    the service is a rule the contract does not state, and one enforced only here is one a partner
    can walk around by sending a single field.
  */
  .superRefine((value, context) => {
    if (
      value.propertyTypeCode !== undefined &&
      !usesStarRating(value.propertyTypeCode) &&
      value.starRating !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['starRating'],
        message: ERROR.VALIDATION_STAR_RATING_NOT_A_HOTEL,
      });
    }
  });
export type PropertyUpdateInput = z.infer<typeof propertyUpdateSchema>;

/**
 * What KIND of bed a unit has — «سرير فردي» or «سرير مزدوج» (Bashar, 2026-09-16).
 *
 * The listing used to say how MANY beds and never what they were, so «سرير واحد» left a guest
 * booking a room for two on a hope. A count and a kind answer different questions and a traveller
 * needs both.
 *
 * ## Why one kind for the unit rather than an inventory of beds
 *
 * A room with one double and two singles cannot be said here, and that is a deliberate limit
 * rather than an oversight: expressing it means a LIST of `{ kind, count }` rows, which is a
 * second table, a second partner form and a second thing for a search filter to reason about.
 * `units.beds` is one number today, and one kind beside it is the honest extension of that shape.
 * When a partner needs to describe a mixed room, the model is what changes, not this enum.
 *
 * ## Why exactly two
 *
 * These are the two Bashar named. A third — twin, bunk, a sofa bed — is a migration and three
 * strings, and every value added is a word a partner has to choose between and three translations
 * somebody has to be right about. Two that are certainly correct beat five that are guesses.
 *
 * ## There is no «not said», anywhere
 *
 * It was nullable for half a day. Bashar, 2026-09-16: *«We should be not allowed on the entire
 * system to define only "سرير" — every bed should be defined as سرير مزدوج or سرير فردي, also on
 * multiple beds.»* So a kind is REQUIRED to create a unit and cannot be cleared on an update, the
 * column is `NOT NULL`, and the listing has no phrasing left that prints a bed without its kind.
 *
 * «Also on multiple beds» is the same rule one step along: a three-bed room reads «3 أسرّة مزدوجة»,
 * not «3 أسرّة». The kind is a property of the room's beds, so it survives the count.
 */
export const bedTypeSchema = z.enum(['single', 'double']);

export type BedType = z.infer<typeof bedTypeSchema>;

/** The same two as a LIST, for a form to render — derived, never written twice. */
export const BED_TYPES = bedTypeSchema.options;

export const unitCreateSchema = z
  .object({
    name: translatedText(160),
    maxGuests: z.number().int().min(1).max(50),
    bedrooms: z.number().int().min(0).max(30).default(1),
    beds: z.number().int().min(1).max(50).default(1),
    /**
     * REQUIRED, with no default — a unit cannot be created without saying what its beds are.
     *
     * No `.default('single')` here even though the column carries one: a default in the contract
     * would let the partner's own form omit the question and answer it on their behalf, which is
     * precisely «defining only سرير» wearing a different hat. The column's default exists for
     * fixtures and for the rows that predate the field, not for anybody filling in this form.
     */
    bedType: bedTypeSchema,
    bathrooms: z.number().int().min(0).max(30).default(1),
    basePrice: z.number().min(0).max(1_000_000),
    currencyCode: z.string().trim().length(3),
    minNights: z.number().int().min(1).max(365).default(1),
    maxNights: z.number().int().min(1).max(365).optional(),
    /**
     * Groups interchangeable units for display, e.g. "double_sea_view". NOT a
     * quantity — one row is still one physical unit, which is what keeps the
     * booking exclusion constraint exact. `quantity` below is how a partner
     * asks for several of them without typing the form several times.
     */
    roomTypeCode: z.string().trim().min(1).max(60).optional(),
    unitLabel: z.string().trim().min(1).max(60).optional(),
    /**
     * How many identical rooms of this type to open (Bashar, 2026-09-06).
     *
     * A hotel floor with fourteen identical doubles was fourteen passes through this form. The
     * platform now creates the rows, groups them under one `roomTypeCode` and numbers their
     * labels — so a partner describes a room TYPE once and says how many there are.
     *
     * It does NOT become a column. Each room stays its own row because the double-booking
     * guarantee is an EXCLUDE constraint over `(unit_id, dates)`, and a counter cannot be made
     * safe under concurrency the way that constraint is. This is an authoring convenience over an
     * unchanged model, which is the only version of it worth having.
     *
     * Capped at 50, matching `initialUnits.count` on the create form — the same act on the other
     * screen, so the two must not disagree about what is allowed.
     */
    quantity: z.number().int().min(1).max(50).default(1),
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
    /**
     * Two-way, not three: the other kind, or absent to leave it alone.
     *
     * `null` is deliberately NOT accepted. Every other clearable field on this form has an empty
     * state that means something — a room with no label, a stay with no maximum — and a bed with
     * no kind is the one state the platform refuses to hold. A partner corrects a mistake by
     * picking the other kind, which is the only correction there is.
     */
    bedType: bedTypeSchema.optional(),
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
/**
 * §8.2 — «أنواع أخرى قابلة للإضافة من الإدارة».
 *
 * The seven types the SRS lists exist as rows, and adding an eighth required a migration and a
 * deploy: `property-types` was a single public `GET` and nothing wrote the table. That is exactly
 * what the sentence says must not be necessary.
 *
 * Deliberately small. This adds a type and can retire one; it is not a catalogue editor. Renaming,
 * reordering and glyphs are edits to a row that already exists and nobody is blocked on them.
 */
export const propertyTypeCreateSchema = z
  .object({
    /*
      The stable identifier, and the one field that can never be corrected later — it is written
      into `properties.property_type_id`'s row and read by the customer site's filters. Bounded to
      the shape the existing seven already use so a new one cannot arrive as «Hotel » or «hôtel».
    */
    code: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(40, ERROR.VALIDATION_TOO_LONG)
      .regex(/^[a-z][a-z0-9_]*$/, ERROR.VALIDATION_CODE_INVALID),
    nameAr: z
      .string()
      .trim()
      .min(1, ERROR.VALIDATION_REQUIRED)
      .max(80, ERROR.VALIDATION_TOO_LONG),
    nameEn: z
      .string()
      .trim()
      .min(1, ERROR.VALIDATION_REQUIRED)
      .max(80, ERROR.VALIDATION_TOO_LONG),
    /* All three languages, because §8.2's list is customer-facing and the catalogue rule is total. */
    nameDe: z
      .string()
      .trim()
      .min(1, ERROR.VALIDATION_REQUIRED)
      .max(80, ERROR.VALIDATION_TOO_LONG),
    /** «hotels have rooms under one roof; a villa is a single unit» — it changes the booking UX. */
    hasMultipleUnits: z.coerce.boolean().default(false),
  })
  .strict();

export type PropertyTypeCreateInput = z.infer<typeof propertyTypeCreateSchema>;

/** Retiring a type: it stops being offered and the properties already using it are untouched. */
export const propertyTypeActiveSchema = z
  .object({ isActive: z.coerce.boolean() })
  .strict();

export type PropertyTypeActiveInput = z.infer<typeof propertyTypeActiveSchema>;

/**
 * How many photographs one listing may carry.
 *
 * ## Why there is a cap at all
 *
 * §5.5 rewards photo count in the recommendation ranking, so an uncapped gallery is a lever a
 * partner can pull instead of improving the listing. It also bounds what the review screen and the
 * customer gallery have to render.
 *
 * ## Why it lives here
 *
 * It was 30, written twice — once in `property-images.service.ts` and once in the partner app's
 * `image-manager.tsx`, kept in step by a comment saying "matches the API". Two copies of a number
 * that MUST agree is the drift this package exists to prevent: the API refusing at a figure the
 * screen has not heard of is a partner told they may upload one more and then refused.
 *
 * Raised to 40 on Bashar's instruction (2026-08-26).
 */
export const MAX_PROPERTY_IMAGES = 40;

/**
 * A partner's negotiated commission, set by hand by a super admin (Bashar, 2026-08-31).
 *
 * Both fields are nullable and both nulls MEAN something: a null rate is «use the platform rate»,
 * a null cap is «no ceiling». Neither is a default — a partner who negotiated 0% and a partner
 * nobody has negotiated with are different arrangements, and a schema that could not tell them
 * apart would bill one of them wrongly.
 *
 * The rate is a FRACTION, not a percent: 0.0725 is 7.25%. The console shows percent because that
 * is how a person says it and converts on the way in, which keeps the stored value the same shape
 * as `commission.partner_rate` — two representations of one number in one system is how they
 * drift.
 *
 * Capped at 0.5 because a commission over half the booking is a typo, not a deal, and this is the
 * field where a misplaced decimal costs a partner half their revenue.
 */
export const partnerCommissionSchema = z
  .object({
    commissionRate: z.number().min(0).max(0.5).nullable(),
    commissionCapUsd: z.number().min(0).max(1_000_000).nullable(),
  })
  .strict();

export type PartnerCommissionInput = z.infer<typeof partnerCommissionSchema>;

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
