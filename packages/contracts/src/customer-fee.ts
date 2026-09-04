/**
 * Whether SAFRA's service fee is NAMED to the customer — one setting, read one way.
 *
 * ## Why this is a setting and not a decision in each screen
 *
 * Bashar asked on 2026-09-03 for the fee to come off the customer's screens, and it was taken off
 * two of them — the checkout summary and the invoice — by two separate pieces of code that each
 * decided it locally. On 2026-09-04 he asked for the decision to be *"configurable through the
 * settings or Rules Engine"*, with *"one shared setting and one consistent pricing rule, without
 * per-surface hard-coding"*.
 *
 * That last clause is the whole point of this file. Two surfaces that decide separately do not
 * disagree on the day they are written; they disagree on the day one of them is changed. A checkout
 * that names the fee above an invoice that folds it is not a cosmetic inconsistency — it is two
 * documents about one payment that do not describe the same charge.
 *
 * ## It changes PRESENTATION only, and never a figure
 *
 * *"In both modes, the final total shown before payment must exactly match the total charged."*
 * The fee is computed, charged, posted to the ledger and itemised on the booking row identically in
 * both modes. Nothing downstream of this reads it: not `pricing.service.ts`, not the ledger, not
 * the partner's payable, not the staff console — which itemises the fee always, because a support
 * agent explaining a charge needs to see what it was made of.
 *
 * ## Hidden is the default
 *
 * The seeded value is `false`, because that is what the platform does today and Bashar asked for it
 * three times. A setting whose default reverses a decision somebody made deliberately is a silent
 * change of behaviour on the next deployment, which is exactly what a setting is supposed to
 * prevent.
 */
export const CUSTOMER_FEE_VISIBLE_SETTING = 'commission.customer_fee_visible';

/**
 * Reads the flag out of the public settings map that every customer surface already receives.
 *
 * Takes the MAP rather than a boolean so no caller has to remember the key's spelling — a
 * mistyped key reads as `undefined`, which is falsy, which silently hides the fee and looks
 * exactly like the setting being off. Anything that is not literally `true` (or the string
 * `'true'`, which is how a hand-edited `jsonb` row arrives) leaves the fee unnamed.
 */
export function customerFeeVisible(settings: Record<string, unknown>): boolean {
  const raw = settings[CUSTOMER_FEE_VISIBLE_SETTING];

  return raw === true || raw === 'true';
}
