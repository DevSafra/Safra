import { z } from 'zod';

/**
 * The two FAQs under تقييمات الضيوف on a property page (Bashar, 2026-09-28).
 *
 * Two write surfaces, and the split between them is the authorization:
 *
 * - **A property question** is written by a super admin and ANSWERED by the partner who owns the
 *   listing. Two different actors, two schemas, and a partner can reach only the answer half.
 * - **A general entry** is written AND answered by a super admin. There is no partner schema for
 *   it at all, which is how «a partner cannot write SAFRA's voice» is enforced: not by a check,
 *   but by there being no shape a partner could post.
 *
 * ## Every string is bounded, because two of them are partner-supplied and public
 *
 * An answer is written by a partner and rendered on an internet-facing page. It is TEXT on the way
 * out — React escapes it and nothing here goes near `dangerouslySetInnerHTML` — so the limit is
 * about a page nobody can read and a payload nobody wants to store, not about injection. The
 * injection answer is the renderer's, and it is already the right one.
 *
 * ## Arabic is required, English and German are optional
 *
 * The pattern every authored row on this platform follows — `properties`, `amenities`,
 * `property_types`. Arabic is the source language and `localisedText` falls back to it, so a
 * partner who answers only in Arabic still produces a page that works in three languages. Making
 * all three required would mean a partner who speaks one language cannot answer at all; making
 * Arabic optional would mean a listing whose FAQ is blank for the majority of readers.
 */

/**
 * The most FAQ entries a public property page will ever carry, per section.
 *
 * ## Why a hard cap when a bounds test already exists
 *
 * `catalogue-bounds.integration.test.ts` fails at 40 questions and names the work, which is the
 * ALARM. This is the BACKSTOP, and the two are deliberately different numbers: the alarm fires
 * first, so a page is never silently truncated before somebody has been told the set outgrew the
 * screen. Past that, the page stays finite whatever anybody does to the table.
 *
 * Without it the payload is unbounded by construction — every answered question, in three
 * languages, on a page rule 3 gives a 200ms p95 and a 2s load budget. Nothing else caps it: the
 * contract limits one REQUEST to 100 answers, and an admin creates questions without limit.
 */
export const PUBLIC_FAQ_LIMIT = 50;

/** A question a person reads. Long enough for a real sentence, short enough to stay a question. */
const questionText = z.string().trim().min(3).max(300);

/** An answer. Two thousand characters is several paragraphs — past that it is not an FAQ answer. */
const answerText = z.string().trim().min(1).max(2000);

/**
 * An optional translation: `null` clears it, and OMITTING it leaves it alone.
 *
 * The distinction is load-bearing and was wrong: `.transform((v) => (v ? v : null))` maps an absent
 * field to `null`, so a PATCH carrying only a question would have WIPED the English and German copy it
 * never mentioned — and the service's `=== undefined ? before : input` merge could never see the
 * `undefined` it tests for. Preserving it keeps «not mentioned» and «cleared» different requests.
 */
const optionalText = (schema: z.ZodString) =>
  z
    .string()
    .trim()
    .max(schema.maxLength ?? 2000)
    .nullable()
    .transform((value) => value || null)
    /* LAST, so the KEY itself is optional — a transform inside `.nullish()` makes it required. */
    .optional();

/**
 * Where a question sits in the list the reader meets.
 *
 * Bounded rather than unbounded so the column cannot be used to store something else, and so two
 * questions cannot be ordered a million apart by a caller who meant to type 10.
 */
const position = z.number().int().min(0).max(999);

/* ── The super admin's half: the questions partners answer ───────────────────────────────── */

export const faqQuestionCreateSchema = z
  .object({
    questionAr: questionText,
    questionEn: optionalText(questionText),
    questionDe: optionalText(questionText),
    /**
     * Blocks a listing being SUBMITTED while unanswered.
     *
     * Never retroactive: making a question required after 2,998 listings exist must not
     * un-publish one of them, and an operator adding a question should not have to think
     * about that. The API enforces it where a listing is submitted, and nowhere else.
     */
    isRequired: z.boolean().default(false),
    position: position.default(0),
  })
  .strict();

export const faqQuestionUpdateSchema = z
  .object({
    questionAr: questionText.optional(),
    questionEn: optionalText(questionText),
    questionDe: optionalText(questionText),
    isRequired: z.boolean().optional(),
    /** Retired: no longer asked of new listings, and answers already given keep rendering. */
    isActive: z.boolean().optional(),
    position: position.optional(),
  })
  .strict();

/* ── The super admin's other half: the questions SAFRA answers itself ────────────────────── */

export const generalFaqCreateSchema = z
  .object({
    questionAr: questionText,
    questionEn: optionalText(questionText),
    questionDe: optionalText(questionText),
    answerAr: answerText,
    answerEn: optionalText(answerText),
    answerDe: optionalText(answerText),
    position: position.default(0),
  })
  .strict();

export const generalFaqUpdateSchema = z
  .object({
    questionAr: questionText.optional(),
    questionEn: optionalText(questionText),
    questionDe: optionalText(questionText),
    answerAr: answerText.optional(),
    answerEn: optionalText(answerText),
    answerDe: optionalText(answerText),
    isActive: z.boolean().optional(),
    position: position.optional(),
  })
  .strict();

/* ── The partner's half: answering, and nothing else ─────────────────────────────────────── */

/**
 * One answer to one question.
 *
 * The property is NOT in this shape. It comes from the route, and the route resolves it against
 * the caller's own partner — so «answer a question on somebody else's listing» is not a request
 * this API can be made to accept. §1: authorization is a `WHERE` clause, not a check afterwards.
 */
export const propertyFaqAnswerSchema = z
  .object({
    questionId: z.string().uuid(),
    answerAr: answerText,
    answerEn: optionalText(answerText),
    answerDe: optionalText(answerText),
  })
  .strict();

/**
 * The whole set, submitted together.
 *
 * One request rather than one per question, because «are the required ones answered» is a question
 * about the SET and a per-question endpoint could only ever answer it a question at a time. The
 * cap is generous and finite: an operator with a hundred questions has a different problem, and an
 * unbounded array is a free write amplification.
 */
export const propertyFaqAnswersSchema = z
  .object({
    answers: z.array(propertyFaqAnswerSchema).max(100),
    /*
      Questions whose answer the partner EMPTIED (audit 2026-10-04). An empty box cannot travel as
      an answer, because `answerAr` is required, so before this a cleared answer was simply left
      out and stayed on the public listing while the form said «تم الحفظ».
    */
    cleared: z.array(z.string().uuid()).max(100).default([]),
  })
  .strict();

export type FaqQuestionCreateInput = z.infer<typeof faqQuestionCreateSchema>;
export type FaqQuestionUpdateInput = z.infer<typeof faqQuestionUpdateSchema>;
export type GeneralFaqCreateInput = z.infer<typeof generalFaqCreateSchema>;
export type GeneralFaqUpdateInput = z.infer<typeof generalFaqUpdateSchema>;
export type PropertyFaqAnswerInput = z.infer<typeof propertyFaqAnswerSchema>;
/** The INPUT shape: `cleared` is optional to a caller, and the schema defaults it to empty. */
export type PropertyFaqAnswersInput = z.input<typeof propertyFaqAnswersSchema>;
