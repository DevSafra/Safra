import { z } from 'zod';
import { ERROR } from './error-codes.js';

/**
 * Staff two-factor enrolment (SRS §4.1 sensitive operations, project rule 1).
 *
 * Login already verifies a TOTP code; these are the endpoints that let a staff
 * member actually turn it on. Without them the feature was unreachable.
 */

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, ERROR.VALIDATION_CODE_SIX_DIGITS);

/** Confirming enrolment proves the authenticator app is genuinely configured. */
export const totpEnableSchema = z.object({ code: totpCodeSchema }).strict();
export type TotpEnableInput = z.infer<typeof totpEnableSchema>;

/**
 * Disabling requires BOTH the password and a current code.
 *
 * A stolen session should not be able to remove the second factor — that would make
 * 2FA worthless precisely when it matters most.
 */
export const totpDisableSchema = z
  .object({
    password: z.string().min(1).max(256),
    code: totpCodeSchema,
  })
  .strict();
export type TotpDisableInput = z.infer<typeof totpDisableSchema>;

/** A recovery code, accepted in place of a TOTP code at sign-in. */
export const recoveryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, ERROR.VALIDATION_RECOVERY_CODE_FORMAT);

export interface TotpSetupResponse {
  /** otpauth:// URI for an authenticator app to scan. */
  otpauthUri: string;
  /** The same secret in text form, for manual entry. */
  secret: string;
}

export interface TotpEnableResponse {
  enabled: true;
  /** Shown ONCE. They are hashed server-side and cannot be retrieved again. */
  recoveryCodes: string[];
}
