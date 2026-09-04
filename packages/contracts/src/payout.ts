import { z } from 'zod';

/**
 * Partner payouts — the shapes the API validates and the console posts.
 *
 * Shared rather than restated in each app for the reason every schema here is shared: a form that
 * enforces its own idea of the rules drifts from the endpoint that enforces the real ones, and the
 * drift shows up as a request that passes the browser and fails the server with a message nobody
 * wrote for a person to read.
 */

/**
 * Every payout state, in lifecycle order.
 *
 * Mirrors the `payout_status` enum in `packages/db/src/schema/enums.ts`. Two lists is one more than
 * can stay in step, so the ORDER here is the only thing this adds: a filter dropdown that lists
 * states alphabetically makes an operator hunt for the one they want, and `accruing` before `paid`
 * is how the money actually travels.
 */
export const PAYOUT_STATUSES = [
  'accruing',
  'pending_release',
  'on_hold',
  'scheduled',
  'paid',
  'cancelled',
] as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/**
 * A payout that has REACHED ITS END: the money moved, or it never will.
 *
 * The complement — everything a partner is still waiting on — is derived from this rather than
 * listed, and the direction is deliberate. A status added to the enum and forgotten here shows up
 * under «قيد الانتظار», where a partner sees it and asks; listed the other way round it would be
 * filed silently into history and vanish from the screen that matters. `payoutIsSettled` is what
 * مستحقاتي groups on, so getting this backwards hides somebody's money.
 *
 * Held by `payout.test.ts` against `PAYOUT_STATUSES`, so a new state cannot be added without this
 * file being read.
 */
export const SETTLED_PAYOUT_STATUSES = ['paid', 'cancelled'] as const;

export function payoutIsSettled(status: string): boolean {
  return (SETTLED_PAYOUT_STATUSES as readonly string[]).includes(status);
}

/**
 * Releasing a payout for transfer.
 *
 * `scheduledFor` is a DATE, not a timestamp — the handoff's line is "مجدول يوم الخميس", and a
 * transfer is scheduled for a banking day rather than an instant.
 */
export const payoutReleaseSchema = z
  .object({
    scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export type PayoutReleaseInput = z.infer<typeof payoutReleaseSchema>;

/**
 * Recording that the transfer happened.
 *
 * `paidReference` is required and has no default. It is the bank's own reference, and it is what
 * lets a partner's "where is my money" be answered against a statement rather than against our
 * own record of our own claim. A payout marked paid with nothing to look up is a reconciliation
 * dead end.
 */
export const payoutPaidSchema = z
  .object({ paidReference: z.string().trim().min(1).max(120) })
  .strict();

export type PayoutPaidInput = z.infer<typeof payoutPaidSchema>;

/** Holding or cancelling — both demand a reason, because both are answerable to the partner. */
export const payoutReasonSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

export type PayoutReasonInput = z.infer<typeof payoutReasonSchema>;
