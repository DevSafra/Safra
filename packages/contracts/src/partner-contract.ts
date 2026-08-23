/**
 * When one scan carrying BOTH signatures may be filed by staff (Bashar, 2026-08-23).
 *
 * ## Why this is a shared predicate rather than a condition written twice
 *
 * The rule has to hold in two places at once: the API refuses the upload, and the console declines
 * to offer the button. Written separately they disagree the first time one of them changes — and
 * the failure mode is specific and nasty. The console's onboarding screen is reachable for ANY
 * partner, and approval happens on that same screen, one step below the contract panel. So a
 * screen that decided for itself would keep showing the control after an approval the server has
 * already started refusing: the operator presses a visible button and gets a coded refusal for a
 * reason nothing on the page hinted at.
 *
 * One function, imported by both, so the button is absent in exactly the cases the API rejects.
 *
 * ## Why these two states and not "anything except approved"
 *
 * `pending` and `in_review` are the window in which a partner is still being ADDED — which is the
 * whole of Bashar's constraint: the joint path is for onboarding somebody sitting with you, not
 * for maintaining a live counterparty's agreement.
 *
 * `approved` is out because they are a live partner: a change to their contract goes through the
 * ordinary two-step flow, where each signature is something the signer's own account did. By then
 * they have redeemed their invitation, so that path is actually open to them.
 *
 * `rejected` is out for a different reason, and it would be the easy one to miss by writing
 * `!== 'approved'`: filing a signed partnership agreement for a partner the platform has turned
 * down records an agreement with somebody we declined to do business with.
 */
export const JOINT_CONTRACT_VERIFICATIONS = ['pending', 'in_review'] as const;

/** True while a partner is still being added, and a joint upload is therefore in scope. */
export function canFileJointContract(verification: string): boolean {
  return (JOINT_CONTRACT_VERIFICATIONS as readonly string[]).includes(verification);
}
