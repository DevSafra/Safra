/**
 * Whether a new password and its confirmation agree.
 *
 * A confirmation field exists to catch a TYPO, not to enforce a security property — which is why this
 * lives on the client and why the confirmation is never sent to the API. The server has no second value
 * to compare, and `passwordChangeSchema` is `.strict()`, so a `confirmPassword` field would be refused
 * rather than ignored. Sending it would also mean the password crossing the wire twice for no gain.
 *
 * It is a shared rule rather than four copies because the three decisions below are easy to get subtly
 * wrong, and each wrong version fails quietly — the reader is told their passwords differ when they do
 * not, or is let through when they do.
 */

/**
 * The two agree, and there is something to agree about.
 *
 * Empty is NOT a match. Used as a submit guard, `password === confirmation` alone would wave through a
 * form where both fields are blank — the browser's `required` normally stops that, but a guard that
 * depends on another guard is one refactor away from being wrong.
 *
 * The comparison is EXACT and never trimmed. Leading and trailing spaces are legitimate characters in a
 * passphrase, and the schema deliberately preserves them; trimming here would report a match between
 * two values the server will store as different.
 */
export function passwordsMatch(password: string, confirmation: string): boolean {
  return password.length > 0 && password === confirmation;
}

/**
 * Whether to SHOW the reader a mismatch.
 *
 * Not simply `!passwordsMatch(...)`. That is true from the moment the new-password field has a
 * character in it, so the form would shout "these do not match" at somebody who has not yet reached the
 * second field — an error about a mistake they have not made. The warning waits until they have typed
 * into the confirmation.
 */
export function passwordMismatch(password: string, confirmation: string): boolean {
  return confirmation.length > 0 && password !== confirmation;
}
