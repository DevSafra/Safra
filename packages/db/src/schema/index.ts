/**
 * Single entry point for the SAFRA database schema.
 *
 * Files are grouped by domain and mirror the module list in SRS §14, so a change
 * to booking rules touches booking.ts and nothing else.
 *
 * Not yet modelled — these arrive with the phases that own them:
 *   - disputes, message threads, notifications  → Phase 5 (Comms)
 *   - advertisements                            → Phase 6 (Ads)
 *   - mobility (Van / car rental)               → post-MVP, unblocked by
 *     partnerTypes being data rather than an enum (§12)
 */
export * from './_shared.js';
export * from './enums.js';
export * from './geo.js';
export * from './identity.js';
export * from './partner.js';
export * from './property.js';
export * from './booking.js';
export * from './payment.js';
export * from './wallet.js';
export * from './sanctions.js';
export * from './audit.js';
export * from './settings.js';
