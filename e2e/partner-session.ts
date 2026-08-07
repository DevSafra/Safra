/**
 * Shared plumbing for the لوحة الشريك browser tests.
 *
 * Not named `*.spec.ts` or `*.setup.ts` on purpose: Playwright collects both, and it refuses to
 * let a spec import a setup file — so the constants they share have to live somewhere that is
 * neither. `staff.ts` exists for the same reason and this mirrors it.
 */

/** Where `partner.setup.ts` writes the captured session, and the specs read it. */
export const PARTNER_STATE = 'test-results/.partner-session.json';

export const PARTNER_BASE = process.env['PARTNER_URL'] ?? 'http://localhost:3002';
export const PARTNER_EMAIL = process.env['DEV_PARTNER_EMAIL'] ?? 'partner1@safra.test';
export const PARTNER_PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';

/**
 * The fixture partners' shared authenticator secret, and the one deliberately without it.
 *
 * `db:testbed` enrols partner1 and partner2 and leaves partner3 unenrolled — see the note on
 * `twoFactorEnrolled` in the seed. partner3 is the FORCED-ENROLMENT fixture: an account that
 * existed before 2FA was mandatory, which is the migration behaviour the suite has to keep
 * proving rather than assume.
 */
export const PARTNER_TOTP_SECRET =
  process.env['TESTBED_PARTNER_TOTP_SECRET'] ?? 'KRSXG5CTMVRXEZLUMU2TAMBQGAYA';

export const UNENROLLED_PARTNER_EMAIL = 'partner3@safra.test';
