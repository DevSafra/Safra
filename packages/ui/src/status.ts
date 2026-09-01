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
  /** A payout period still collecting bookings. Nothing is owed to anybody yet this month. */
  accruing: 'sky',
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
  /*
    An export being BUILT by a worker (BullMQ phase 5).

    `indigo` rather than reusing `processing`'s purple: the two never share a screen, so the rule
    would allow it, but a distinct value earning a distinct colour is what keeps rule 1 checkable —
    "the same status is the same colour everywhere" is only meaningful while one colour means one
    thing.
  */
  running: 'indigo',

  /*
    ── Payouts ───────────────────────────────────────────────────────────────

    `scheduled` is GREEN and `paid` is teal, matching the handoff's own green dot on
    «تحويل مستحقات ... مجدول يوم الخميس». A scheduled transfer is the good outcome a partner is
    waiting for; a paid one is the finished one, and the two sit in the same column so they cannot
    share a colour.
  */
  scheduled: 'ok',
  paid: 'teal',

  // ── Waiting on somebody ───────────────────────────────────────────────────
  /**
   * A partnership REQUEST nobody has rung yet (Bashar, 2026-08-19).
   *
   * Amber, with the rest of "waiting on somebody": an unanswered request is work for SAFRA, not
   * a state of the applicant's. `accepted` takes green and `contacted` indigo, so the queue's
   * four values are four colours.
   */
  submitted: 'warn',
  /**
   * Rung, and awaiting the decision. Indigo rather than `in_review`'s sky, because the
   * application's own detail screen shows the partner's VERIFICATION beside it once accepted —
   * and `in_review` is one of the values that screen can paint.
   */
  contacted: 'indigo',
  /** A request that became a partner. Green: the outcome the applicant was waiting for. */
  accepted: 'ok',
  pending_payment: 'warn',
  pending_review: 'warn',
  requires_action: 'warn',
  investigating: 'warn',
  paused: 'warn',
  queued: 'warn',
  /* A built export, waiting to be collected. Distinct from `active`'s green by design. */
  ready: 'lime',
  awaiting_partner_signature: 'warn',
  /** A closed payout period waiting for somebody to decide to send it. */
  pending_release: 'warn',
  /** Gold: `pending` sits beside `requires_action` and `processing` in الدفع. */
  pending: 'gold',
  /**
   * An advertising invoice nobody has paid yet — money owed, which is what gold says in الدفع.
   *
   * It shares a SCREEN with the campaign registry's four statuses (see `adsScreen` below), and
   * gold is free there. `pending`'s gold is not a clash: they are different values and no screen
   * shows both.
   */
  due: 'gold',
  /** Orange: ran out. Not red — nothing went wrong — and not `failed`'s colour. */
  expired: 'orange',
  /** Also orange: a payout stopped on purpose is not a failure, and must not read as one. */
  on_hold: 'orange',

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
  /** An advertising invoice that will never be collected — written off, like `waived`. */
  void: 'stone',
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
  /**
   * «طلبات الشراكة» — a request to join, before there is a partner.
   *
   * Four values on one registry, so four tones. `rejected` keeps its red from everywhere else:
   * the same status is the same colour, which is rule 1.
   */
  partnerApplication: ['submitted', 'contacted', 'accepted', 'rejected'],
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
  /**
   * What الإعلانات actually paints, which is not either enum on its own.
   *
   * The screen carries TWO paged tables — the campaign registry and فواتير الإعلانات beneath it —
   * so rule 2's "one screen" spans seven values across two enums. `ad` above stays because rule 1
   * is about a value's colour everywhere; this entry is the constraint a reader of that page meets.
   *
   * Same reasoning as `payments`, which unions three vocabularies onto one table.
   */
  adsScreen: ['draft', 'active', 'paused', 'expired', 'due', 'paid', 'void'],
  adInvoice: ['due', 'paid', 'void'],
  /*
    `draft` was added to the enum on 2026-08-21 with the two-sided signing flow and NOT added here,
    so every sweep that walks this list skipped it — and الشركاء spent two days painting a draft
    contract with the label «ساري حتى —», stating that an unsigned, unsent document was in force.
    A status missing from this list is a status no test is holding to account.
  */
  contract: ['draft', 'awaiting_partner_signature', 'active', 'superseded', 'terminated'],
  /*
    This entry also covers `partner_employee_status`, which is `['active', 'suspended']` — a strict
    SUBSET of it, so rule 2 is already proved for الموظفون by the line below.

    Registering it separately was tried on 2026-08-23 and reverted: a two-value vocabulary fails
    the "at least three values" guard in `status.test.ts`, which exists so a vocabulary that lost
    its values cannot pass rule 2 while proving nothing. Weakening a real guard to admit a
    redundant entry is the wrong trade. If `partner_employee_status` ever gains a third value that
    `user` does not have, it needs its own entry and this note stops being true.
  */
  user: ['active', 'suspended', 'archived'],
  notification: ['queued', 'sent', 'delivered', 'failed'],
  /**
   * Whether a partner has taken up a coupon — `coupon_partner_status`.
   *
   * Three values on one table, three tones. Each keeps the colour it has elsewhere: `pending` the
   * amber of a queue waiting on somebody, `accepted` the green it has on طلبات الشراكة, `rejected`
   * the red it has everywhere. Rule 1 is why they are not re-chosen here.
   */
  couponPartner: ['pending', 'accepted', 'rejected'],
  /**
   * The payout lifecycle.
   *
   * Six values on one registry, so six distinct tones. `cancelled` is shared with bookings and
   * keeps its red there and here — the same status is the same colour everywhere, which is rule 1.
   */
  payout: ['accruing', 'pending_release', 'on_hold', 'scheduled', 'paid', 'cancelled'],
  /**
   * A requested CSV, on الملفات المصدَّرة.
   *
   * Four values on one table, so four tones. `queued` keeps the amber it has on سجل المراسلات and
   * `failed` the red it has everywhere — the same status is the same colour across screens, which
   * is rule 1, and it is why these two are not re-chosen here.
   */
  export: ['queued', 'running', 'ready', 'failed'],
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
