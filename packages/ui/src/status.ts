/**
 * One status colour vocabulary for the whole project.
 *
 * Two rules, and they pull in opposite directions until you state both (Bashar, 2026-08-06):
 *
 *  1. **A status is the same colour everywhere.** `expired` was red in الدفع, grey in الإعلانات
 *     and amber in بطاقات الهدايا. An operator does not hold "which registry am I in" in mind
 *     while scanning; they learn that amber means *waiting*, and a colour that changes meaning
 *     between screens un-teaches that.
 *  2. **No two statuses on ONE SCREEN share a colour.** Collapsing everything onto seven semantic
 *     tones satisfied rule 1 and broke this: «مؤكد» and «مكتمل» were both green in الحجوزات, and
 *     six different payment states were all amber. A column where six rows look identical is a
 *     column you have to read word by word, which is what the colour was for.
 *
 * Rule 2 sets the palette size. The widest screen is the payments registry, which unions payment,
 * refund and wallet statuses onto one table — thirteen values — so there are thirteen colours, and
 * `VOCABULARIES` below is checked against rule 2 by `status.test.ts`. That test is the point: the
 * constraint is not something you can hold in your head while adding a status.
 *
 * ## Hues, not shades
 *
 * The seven tones added for this are spread around the colour wheel rather than being lighter and
 * darker versions of the existing ones. Two greens at different lightness are exactly what a
 * reader scanning a column cannot tell apart, so they would satisfy the test and fail the person.
 *
 * ## What is deliberately NOT here
 *
 * Anything that is not a status: a partner TIER (`gold`, `silver`), a score band, a payment KIND,
 * a scope setting. Those are different axes that happen to be drawn as coloured text.
 */
export type Tone =
  | 'ok'
  | 'teal'
  | 'lime'
  | 'sky'
  | 'indigo'
  | 'pend'
  | 'gold'
  | 'warn'
  | 'orange'
  | 'bad'
  | 'crimson'
  | 'faint'
  | 'slate'
  | 'stone';

const STATUS_TONES: Record<string, Tone> = {
  // ── Finished well. Four colours, because one screen shows four of them at once ──
  confirmed: 'ok',
  published: 'ok',
  active: 'ok',
  captured: 'ok',
  delivered: 'ok',
  resolved: 'ok',
  /** Teal, not green: الحجوزات shows `confirmed` and `completed` in the same column. */
  completed: 'teal',
  /** Lime, not green: العقارات shows `approved` and `published`; الدفع shows `collected`. */
  approved: 'lime',
  collected: 'lime',

  // ── Underway ──────────────────────────────────────────────────────────────
  checked_in: 'sky',
  in_review: 'sky',
  sent: 'sky',
  initiated: 'sky',
  /** Indigo: الدفع already spends sky on `initiated`. */
  authorized: 'indigo',

  /**
   * Purple, never gold — SRS §1 and §14 make this an explicit rule. A paid booking waiting on a
   * partner is not good news, and gold reads as if it were.
   */
  pending_confirmation: 'pend',
  /** Also purple, in a vocabulary that has no `pending_confirmation` to clash with. */
  processing: 'pend',

  // ── Waiting on somebody ───────────────────────────────────────────────────
  pending_payment: 'warn',
  pending_review: 'warn',
  requires_action: 'warn',
  investigating: 'warn',
  paused: 'warn',
  queued: 'warn',
  awaiting_partner_signature: 'warn',
  /** Gold: `pending` sits beside `requires_action` and `processing` in الدفع. */
  pending: 'gold',
  /** Orange: ran out. Not red — nothing went wrong — and not `failed`'s colour. */
  expired: 'orange',

  // ── Wrong ─────────────────────────────────────────────────────────────────
  cancelled: 'bad',
  rejected: 'bad',
  failed: 'bad',
  /** Crimson: each of these shares a screen with a `bad` sibling. */
  disputed: 'crimson',
  suspended: 'crimson',
  open: 'crimson',

  // ── Over, or never started ────────────────────────────────────────────────
  draft: 'faint',
  refunded: 'faint',
  used: 'faint',
  /** Slate and stone: الدفع shows three inactive states at once, عقود الشراكة two. */
  archived: 'slate',
  partially_refunded: 'slate',
  superseded: 'slate',
  waived: 'stone',
  terminated: 'stone',
};

/**
 * Every status vocabulary the project defines, from `packages/db/src/schema`.
 *
 * Here so `status.test.ts` can hold rule 2 — no two values in one list may share a tone. Kept
 * beside the map rather than in the test, because a vocabulary that gains a value has to be
 * updated in exactly one place for the check to keep meaning anything.
 *
 * `payments` is not a database enum: the الدفع registry unions payment, refund and wallet rows
 * onto one table, so its screen shows a vocabulary no single enum describes. That union is the
 * widest constraint in the project and it would be invisible if this listed only the enums.
 */
export const VOCABULARIES: Readonly<Record<string, readonly string[]>> = {
  booking: [
    'draft',
    'pending_payment',
    'pending_confirmation',
    'confirmed',
    'cancelled',
    'checked_in',
    'completed',
    'disputed',
  ],
  property: [
    'draft',
    'pending_review',
    'rejected',
    'approved',
    'published',
    'suspended',
    'archived',
  ],
  verification: ['pending', 'in_review', 'approved', 'rejected'],
  payments: [
    'initiated',
    'requires_action',
    'authorized',
    'captured',
    'failed',
    'expired',
    'refunded',
    'partially_refunded',
    'pending',
    'processing',
    'completed',
    'collected',
    'waived',
  ],
  refund: ['pending', 'processing', 'completed', 'failed'],
  dispute: ['open', 'investigating', 'resolved', 'rejected'],
  giftCard: ['active', 'used', 'expired', 'cancelled'],
  ad: ['draft', 'active', 'paused', 'expired'],
  contract: ['awaiting_partner_signature', 'active', 'superseded', 'terminated'],
  user: ['active', 'suspended', 'archived'],
  notification: ['queued', 'sent', 'delivered', 'failed'],
};

/**
 * The colour for a status, in any of the project's vocabularies.
 *
 * An unrecognised status is `faint` — deliberately the "no signal" colour rather than a warning.
 * A status added to an enum and not to this map must not arrive on screen wearing a colour that
 * claims the operator needs to act on it; grey is the honest answer to "we do not know yet".
 */
export function statusTone(status: string | null | undefined): Tone {
  /*
    `Object.hasOwn`, not a bare lookup. `STATUS_TONES.constructor` is inherited from
    `Object.prototype` and is a FUNCTION, so `STATUS_TONES[status] || 'faint'` returned that
    function for `constructor`, `toString` and `hasOwnProperty` — a non-Tone escaping past a
    return type that promised one, and then indexing the class map to `undefined`. Caught by the
    test beside this file, which is why it exists: this lookup takes a string from a database enum
    and there is no compiler between the two.
  */
  if (!status || !Object.hasOwn(STATUS_TONES, status)) return 'faint';

  return STATUS_TONES[status] ?? 'faint';
}
