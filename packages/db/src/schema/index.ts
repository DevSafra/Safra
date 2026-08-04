/**
 * Single entry point for the SAFRA database schema.
 *
 * Files are grouped by domain and mirror the module list in SRS §14, so a change
 * to booking rules touches booking.ts and nothing else.
 *
 * Not yet modelled — these arrive with the phases that own them:
 *   - mobility (Van / car rental)               → post-MVP, unblocked by
 *     partnerTypes being data rather than an enum (§12)
 *
 * Disputes, conversations, the notification log and advertising landed on 2026-08-04, when the
 * console sections that read them were built. They were listed here as "Phase 5 / Phase 6" for
 * months, which is why the enums (`dispute_status`, `notification_channel`, `ad_status`) and the
 * reference sequences already existed: the vocabulary was designed before the tables.
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
export * from './dispute.js';
export * from './messaging.js';
export * from './advertising.js';
export * from './sanctions.js';
export * from './audit.js';
export * from './settings.js';
