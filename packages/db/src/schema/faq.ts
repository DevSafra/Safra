import { relations } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { foreignId, notDeleted, primaryId, timestamps } from './_shared.js';
import { properties } from './property.js';

/**
 * The two FAQs on a property page (Bashar, 2026-09-28).
 *
 * They look like one feature and are two, because they differ in WHO KNOWS THE ANSWER:
 *
 * - **A property question** is asked once by SAFRA and answered by every partner about their own
 *   listing — «هل الإفطار مشمول؟» has 2,998 different answers and none of them is SAFRA's to give.
 * - **A general entry** is asked and answered by SAFRA — «كيف أُلغي حجزًا؟» has one answer, it is
 *   about the platform rather than the property, and a partner must not be able to write it.
 *
 * Modelling them as one table with a nullable `property_id` was the obvious shortcut and is wrong:
 * the two have different authors, different authorization, different lifecycles and different
 * required-ness. The join would have to carry «who may write this row» as data, which is the thing
 * §1 says belongs in a `WHERE` clause.
 *
 * ## Why questions are a table and not a setting
 *
 * The same reason كتالوج المنصّة gives for amenities and cancellation policies: adding a question
 * must not mean SQL against production. Bashar asks for the question, partners answer it, and
 * neither step is a deploy.
 *
 * ## Arabic is required, English and German are not
 *
 * The pattern every piece of authored content on this platform already follows — `properties`,
 * `property_types`, `amenities`. Arabic is the source language and `localisedText` falls back to
 * it, so a partner who answers only in Arabic produces a page that works in three languages rather
 * than a German reader meeting an empty accordion. This is content, not chrome: `docs/i18n.md`
 * draws that line and the `@safra/i18n` catalogues stay the home of every word SAFRA itself writes.
 */

/**
 * A question SAFRA asks every partner about their listing.
 *
 * `isRequired` is enforced where a listing is SUBMITTED, never retroactively: making a question
 * required after 2,998 listings exist must not un-publish any of them, and an operator adding a
 * question should not have to think about that. `isActive` retires a question without deleting the
 * answers already given — the same distinction `amenities.is_active` draws, and for the same
 * reason: SAFRA stopping asking is not the partner un-saying it.
 */
export const propertyFaqQuestions = pgTable(
  'property_faq_questions',
  {
    id: primaryId(),
    questionAr: text('question_ar').notNull(),
    questionEn: text('question_en'),
    questionDe: text('question_de'),
    /** Blocks SUBMISSION when unanswered; never un-publishes a listing that predates it. */
    isRequired: boolean('is_required').notNull().default(false),
    /** Retired: no longer asked of new listings, and existing answers stay and still render. */
    isActive: boolean('is_active').notNull().default(true),
    /** The order a reader meets them in, which is the operator's editorial decision. */
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('property_faq_questions_order_idx').on(t.isActive, t.position)],
);

/**
 * One partner's answer to one question about one listing.
 *
 * The unique index is partial on `notDeleted` for the reason `_shared.ts` gives: a soft-deleted
 * answer would otherwise reserve its slot forever, and P-003 means "forever" is literal — a
 * partner who removed an answer could never give another.
 */
export const propertyFaqAnswers = pgTable(
  'property_faq_answers',
  {
    id: primaryId(),
    propertyId: foreignId('property_id')
      .notNull()
      .references(() => properties.id),
    questionId: foreignId('question_id')
      .notNull()
      .references(() => propertyFaqQuestions.id),
    answerAr: text('answer_ar').notNull(),
    answerEn: text('answer_en'),
    answerDe: text('answer_de'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('property_faq_answers_unique')
      .on(t.propertyId, t.questionId)
      .where(notDeleted),
    /* The page's read: every answer for one listing, joined to its question. */
    index('property_faq_answers_property_idx').on(t.propertyId),
  ],
);

/**
 * A question SAFRA asks AND answers, shown under the per-property FAQ on every property page.
 *
 * No `isRequired`: nobody is being asked to fill it in. No partner column: the whole point is that
 * this is SAFRA's voice, identical on every listing, and a partner cannot reach it.
 */
export const generalFaqEntries = pgTable(
  'general_faq_entries',
  {
    id: primaryId(),
    questionAr: text('question_ar').notNull(),
    questionEn: text('question_en'),
    questionDe: text('question_de'),
    answerAr: text('answer_ar').notNull(),
    answerEn: text('answer_en'),
    answerDe: text('answer_de'),
    isActive: boolean('is_active').notNull().default(true),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('general_faq_entries_order_idx').on(t.isActive, t.position)],
);

export const propertyFaqQuestionsRelations = relations(
  propertyFaqQuestions,
  ({ many }) => ({
    answers: many(propertyFaqAnswers),
  }),
);

export const propertyFaqAnswersRelations = relations(propertyFaqAnswers, ({ one }) => ({
  property: one(properties, {
    fields: [propertyFaqAnswers.propertyId],
    references: [properties.id],
  }),
  question: one(propertyFaqQuestions, {
    fields: [propertyFaqAnswers.questionId],
    references: [propertyFaqQuestions.id],
  }),
}));
