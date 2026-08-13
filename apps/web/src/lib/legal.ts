/**
 * When the legal pages were last changed.
 *
 * A CONSTANT, not `new Date()`. A date that moves on its own says the document was reviewed today
 * when nobody looked at it — which on a privacy notice is a false statement about a compliance
 * document, and precisely the field a regulator or a customer checks first.
 *
 * Change it in the same commit that changes the wording, and never otherwise.
 */
export const LEGAL_UPDATED = '2026-08-14';
