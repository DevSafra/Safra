/**
 * Compliance controls that are a POLICY DECISION rather than a constant.
 *
 * Everything here has the same shape: the platform can enforce it, observe it, or not run it at
 * all, and which of those is right is a question for compliance rather than for a deploy.
 */

/**
 * How hard sanctions screening bites (Bashar, 2026-08-21).
 *
 * ## Why this is a setting at all
 *
 * Partner approval used to hard-gate on a recorded screening, and screening refuses a list older
 * than seven days — so with no automated feed, onboarding stopped entirely. That made an external
 * registration (`M-2`) a launch blocker for a control whose LEGAL form is not "run a screening at
 * approval". The obligation is the EU asset-freeze prohibition: do not make funds or economic
 * resources available to a designated person. Screening is the control we chose to discharge it,
 * and the moment and severity of that control are ours to set.
 *
 * The full review, including what was checked and what still needs counsel, is in
 * `docs/sanctions-screening-review.md`.
 *
 * ## The three values
 *
 * - `required` — approval is refused without a screening, and a payout is refused too. What the
 *   platform did before this setting existed.
 * - `advisory` — screening runs and is recorded, and nothing is blocked. The reviewer is told, in
 *   as many words, that they are approving without one.
 * - `off` — screening is not offered at all, and the console says so rather than appearing broken.
 *
 * ## `advisory` is the default, and that is a decision, not an oversight
 *
 * Engineering's recommendation was `required` — the EU lifted its Syria economic sanctions in May
 * 2025 but kept the designations of former-regime figures, so a platform onboarding Syrian
 * businesses is where the residual list is most likely to bite. Bashar chose `advisory` on
 * 2026-08-21 with that stated. It is recorded here because a default that contradicts the review
 * next to it should say why, and because the next person to read this will otherwise assume it was
 * never thought about.
 */
export const SANCTIONS_POLICIES = ['required', 'advisory', 'off'] as const;

export type SanctionsPolicy = (typeof SANCTIONS_POLICIES)[number];

/** The settings row. One constant, because the API reads it and the console edits it. */
export const SANCTIONS_POLICY_SETTING = 'compliance.sanctions_screening';

/**
 * What the platform does when the row is missing.
 *
 * `SettingsService.get` falls back rather than failing, so this value governs a database that has
 * not been seeded since the setting was added. It matches the seeded value deliberately: a
 * fallback that differed from the seed would make behaviour depend on whether a migration had been
 * run, which is the least debuggable kind of difference.
 */
export const DEFAULT_SANCTIONS_POLICY: SanctionsPolicy = 'advisory';

/**
 * Narrows an unknown to a policy.
 *
 * Used on the way OUT of the settings table as well as on the way in. A row edited by hand — the
 * documented escape hatch for settings this form cannot validate — could hold anything, and a
 * typo there must not silently disable a compliance control. Callers fall back to the default,
 * which is the safe direction: an unreadable value means the platform behaves as configured by
 * this file rather than as configured by the typo.
 */
export function isSanctionsPolicy(value: unknown): value is SanctionsPolicy {
  return (
    typeof value === 'string' && (SANCTIONS_POLICIES as readonly string[]).includes(value)
  );
}
