import { z } from 'zod';

import { ERROR } from './error-codes.js';

/**
 * Guest reviews (design handoff §7.3, P-006).
 *
 * ## What is absent, deliberately
 *
 * There is no delete schema and no "edit review" schema. P-006 says a review cannot be deleted,
 * and its score and text are frozen by a database trigger — so a contract describing either would
 * be a shape the system refuses to accept. The two remedies P-006 DOES allow are here: reply, and
 * report.
 */

/** 1–5, matching the CHECK constraint. A ★ score is a small integer, not a free number. */
export const reviewRatingSchema = z.coerce
  .number()
  .int()
  .min(1, ERROR.VALIDATION_REVIEW_RATING_RANGE)
  .max(5, ERROR.VALIDATION_REVIEW_RATING_RANGE);

/**
 * A guest writing about a stay.
 *
 * The booking reference is the subject and there is no property or partner field: which listing a
 * review is about is derived from the booking on the server. Accepting them from the client would
 * let somebody attach a five-star review of their own listing to somebody else's stay.
 */
export const reviewCreateSchema = z
  .object({
    bookingReference: z.string().trim().min(3).max(40),
    rating: reviewRatingSchema,
    body: z.string().trim().min(3).max(2000),
  })
  .strict();

export type ReviewCreateInput = z.infer<typeof reviewCreateSchema>;

/** الرد — the partner's public answer, shown under the review. */
export const reviewReplySchema = z
  .object({ reply: z.string().trim().min(3).max(1000) })
  .strict();

export type ReviewReplyInput = z.infer<typeof reviewReplySchema>;

/**
 * إبلاغ — the partner asking SAFRA to look at a review.
 *
 * A reason is required and has a floor. "Report" with no argument is a button that generates work
 * nobody can act on, and the staff member who picks it up has to be able to see what is alleged.
 */
export const reviewReportSchema = z
  .object({ reason: z.string().trim().min(10).max(1000) })
  .strict();

export type ReviewReportInput = z.infer<typeof reviewReportSchema>;

/**
 * The staff decision on a reported review.
 *
 * `uphold` HIDES the review; `dismiss` leaves it published. Neither deletes it, which is why the
 * verbs are these two rather than "delete"/"keep" — the vocabulary should not suggest a power
 * the system does not have.
 */
export const reviewModerateSchema = z
  .object({
    decision: z.enum(['uphold', 'dismiss']),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();

export type ReviewModerateInput = z.infer<typeof reviewModerateSchema>;
