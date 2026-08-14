/**
 * The password bounds, in their own module.
 *
 * `auth.ts` needs them for the schema and `password-strength.ts` needs them for the length rule the
 * meter renders — and `auth.ts` imports `password-strength.ts`, so putting them in `auth.ts` makes
 * that a cycle. One tiny module both can import is the way out, and it keeps the number in exactly
 * one place, which is the property that matters: it used to be a literal in the schema and a
 * typed-out digit in three catalogue hints.
 */

/**
 * Twelve rather than the eight a reference design suggested.
 *
 * This platform holds wallet balances and payout accounts. Length is the single strongest factor in
 * real-world resistance, and lowering a floor that is already met is a regression somebody would
 * have to justify — so the checklist says twelve.
 */
export const PASSWORD_MIN_LENGTH = 12;

/** Argon2id hashes whatever it is given, so an unbounded password is a CPU-exhaustion vector. */
export const PASSWORD_MAX_LENGTH = 256;
