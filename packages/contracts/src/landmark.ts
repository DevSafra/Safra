import { z } from 'zod';

import { ERROR } from './error-codes.js';

/**
 * What staff may write about a landmark and the kind it belongs to.
 *
 * Landmarks and their kinds are OPERATIONAL DATA — Bashar, 2026-09-23: they are managed
 * through the platform, without a code change or a deployment. That is the same principle
 * `city_categories` and `amenities` already follow, and this file is the boundary that makes
 * it safe to hand an operator the pen.
 */

/**
 * One `d` attribute of one `<path>`, restricted to the SVG path alphabet.
 *
 * ## This is the security control, not a tidiness check
 *
 * Making an icon editable means a value an operator types is rendered into the customer site.
 * The rendering itself is safe — React sets `d` as an ATTRIBUTE, so it parses no markup — but
 * an input that reaches a public page must not depend on one call site staying careful. So the
 * value is restricted at the boundary to the characters an SVG path is made of:
 *
 *   - the commands `M m L l H h V v C c S s Q q T t A a Z z`
 *   - digits, `.`, `,`, `-`, `+`, `e`, `E` (exponents), and whitespace
 *
 * There is no `<`, no `>`, no quote, no `&`, no `(` and no `:` in that set. A string obeying it
 * cannot open an element, close an attribute, start an entity, or form a `url(...)` or a
 * `javascript:` — so even a future caller that interpolated it into markup could not be made to
 * execute anything. `landmark-icon-safety.test.ts` holds that to account with the payloads that
 * would matter.
 *
 * ## Why not an SVG upload
 *
 * An `.svg` is an HTML document. It can carry `<script>`, `<foreignObject>`, event handlers and
 * external references, and serving one from our own origin would hand an operator a stored-XSS
 * primitive on the customer site. Path data is the part of an icon that is actually a drawing.
 */
export const landmarkIconPathSchema = z
  .string()
  .trim()
  .min(1, ERROR.VALIDATION_ICON_PATH)
  .max(2_000, ERROR.VALIDATION_ICON_PATH)
  .regex(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\-+eE\s]+$/, ERROR.VALIDATION_ICON_PATH)
  /*
    A path that is only separators draws nothing and would pass the alphabet check. Requiring a
    command letter means a saved icon is at least an attempt at a shape.
  */
  .refine((value) => /[MmLlHhVvCcSsQqTtAaZz]/.test(value), ERROR.VALIDATION_ICON_PATH);

/**
 * The marks that make up one kind's icon.
 *
 * Capped at six because a legible 24px glyph is two or three strokes; six is generous and
 * bounds what one row can put on a page that renders it for every landmark in a city.
 */
export const landmarkIconPathsSchema = z.array(landmarkIconPathSchema).max(6);

/** `airport`, `transit` — the stable identifier, unchanged by a rename. */
const kindCodeSchema = z
  .string()
  .trim()
  .min(2, ERROR.VALIDATION_CODE_FORMAT)
  .max(40, ERROR.VALIDATION_CODE_FORMAT)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, ERROR.VALIDATION_CODE_FORMAT);

const nameSchema = z.string().trim().min(1).max(120);

export const createLandmarkKindSchema = z
  .object({
    code: kindCodeSchema,
    nameAr: nameSchema,
    nameEn: nameSchema,
    nameDe: nameSchema,
    iconPaths: landmarkIconPathsSchema.default([]),
  })
  .strict();

export type CreateLandmarkKindInput = z.infer<typeof createLandmarkKindSchema>;

export const updateLandmarkKindSchema = z
  .object({
    nameAr: nameSchema.optional(),
    nameEn: nameSchema.optional(),
    nameDe: nameSchema.optional(),
    iconPaths: landmarkIconPathsSchema.optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9_999).optional(),
  })
  .strict();

export type UpdateLandmarkKindInput = z.infer<typeof updateLandmarkKindSchema>;

/** `damascus-international-airport` — the key a «قريب من» search names. */
export const landmarkSlugSchema = z
  .string()
  .trim()
  .min(2, ERROR.VALIDATION_SLUG_FORMAT)
  .max(80, ERROR.VALIDATION_SLUG_FORMAT)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, ERROR.VALIDATION_SLUG_FORMAT);

/**
 * A landmark's coordinates, at FULL precision and deliberately so.
 *
 * The rounding that protects a property's location has no place here: an airport's position is
 * a published fact, and blurring it would make every distance wrong while protecting nobody.
 * The asymmetry IS the model — the listing is the secret, the landmark is the reference frame,
 * and the distance between them is computed from the listing's ROUNDED pair.
 */
const latitudeSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,2}(\.\d{1,8})?$/, ERROR.VALIDATION_LATITUDE_FORMAT)
  .refine((v) => Math.abs(Number(v)) <= 90, ERROR.VALIDATION_LATITUDE_RANGE);

const longitudeSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,3}(\.\d{1,8})?$/, ERROR.VALIDATION_LONGITUDE_FORMAT)
  .refine((v) => Math.abs(Number(v)) <= 180, ERROR.VALIDATION_LONGITUDE_RANGE);

export const createLandmarkSchema = z
  .object({
    citySlug: z.string().trim().min(1).max(80),
    kindCode: kindCodeSchema,
    slug: landmarkSlugSchema,
    nameAr: nameSchema,
    nameEn: nameSchema,
    nameDe: nameSchema,
    latitude: latitudeSchema,
    longitude: longitudeSchema,
  })
  .strict();

export type CreateLandmarkInput = z.infer<typeof createLandmarkSchema>;

export const updateLandmarkSchema = z
  .object({
    citySlug: z.string().trim().min(1).max(80).optional(),
    kindCode: kindCodeSchema.optional(),
    nameAr: nameSchema.optional(),
    nameEn: nameSchema.optional(),
    nameDe: nameSchema.optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9_999).optional(),
  })
  .strict();

export type UpdateLandmarkInput = z.infer<typeof updateLandmarkSchema>;

/**
 * How far a landmark may sit from the centre of the city it is filed under, in kilometres.
 *
 * Not a geography lesson — a TYPO CATCH. Decimal degrees are easy to transpose, and a landmark
 * saved at 36.2,33.5 instead of 33.5,36.2 lands in Iraq while still looking like a plausible
 * pair. Every distance on every property page in that city would then be wrong by hundreds of
 * kilometres, silently, and the only symptom would be a guest deciding the site is broken.
 *
 * 120 km is loose enough for an airport an hour out of town and tight enough that a swapped
 * pair cannot survive it.
 */
export const LANDMARK_MAX_KM_FROM_CITY = 120;
