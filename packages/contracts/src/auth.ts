import { z } from 'zod';
import { ERROR } from './error-codes.js';

/**
 * The single definition of what an auth request may contain. The API validates
 * with these schemas and the web forms resolve against the SAME objects, so a
 * field can never drift between client and server.
 *
 * Every schema uses .strict() — an unknown field is rejected rather than ignored.
 * That is deliberate: silently dropping `{ role: 'super_admin' }` from a
 * registration payload is how privilege-escalation bugs start.
 */

export const LOCALES = ['ar', 'en', 'de'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

/**
 * Password policy. 12 characters minimum rather than the usual 8: this platform
 * holds wallet balances and payout details, and length beats composition rules for
 * real-world strength. Composition is deliberately NOT mandated — forcing
 * "1 symbol" pushes users toward `Password1!` patterns.
 *
 * The upper bound exists because Argon2id hashes whatever it is given, so an
 * unbounded password is a cheap CPU-exhaustion vector.
 */
export const passwordSchema = z
  .string()
  .min(12, ERROR.VALIDATION_PASSWORD_TOO_SHORT)
  .max(256, ERROR.VALIDATION_PASSWORD_TOO_LONG);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email(ERROR.VALIDATION_EMAIL_INVALID)
  .max(254);

/**
 * E.164. Syria, Jordan and Lebanon all use country codes, and WhatsApp
 * notifications (§10.2) require a normalised international number.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, ERROR.VALIDATION_PHONE_FORMAT);

/**
 * Editing your own profile (handoff §6, الملف الشخصي).
 *
 * Name and phone only. EMAIL is deliberately absent: changing the address a person signs in with has
 * to prove they still hold the new one, which is a verification flow with a pending-address column and
 * a mail template — a separate feature, not a field on this form. Offering it here would either skip
 * that proof or fail silently.
 *
 * `.strict()` so an unknown field is a 400 rather than a silently ignored attempt to write something
 * else, and at least one field must be present: an empty PATCH is a mistake worth reporting.
 */
export const profileUpdateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    phone: phoneSchema.optional(),
  })
  .strict()
  .refine((v) => v.fullName !== undefined || v.phone !== undefined, {
    message: ERROR.VALIDATION_ONE_FIELD_REQUIRED,
  });

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

/**
 * Changing your own password.
 *
 * The CURRENT password is required, and that is the whole security value: an access token that leaked
 * — from a shared machine, an XSS, a stolen phone — must not be enough to lock the owner out of their
 * own account. Knowing the present password is the second factor this operation has.
 *
 * The new one goes through the same `passwordSchema` as registration, so the policy cannot drift
 * between the two doors into the same column.
 */
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: passwordSchema,
  })
  .strict()
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: ERROR.VALIDATION_PASSWORD_UNCHANGED,
    path: ['newPassword'],
  });

export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    fullName: z.string().trim().min(2).max(120),
    phone: phoneSchema,
    preferredLocale: localeSchema.default('ar'),
  })
  .strict();
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(256),
    /** Required only once a staff account has TOTP enabled. */
    totpCode: z
      .string()
      .regex(/^\d{6}$/, ERROR.VALIDATION_CODE_SIX_DIGITS)
      .optional(),
    /**
     * Accepted in place of totpCode when the authenticator is lost. Single-use:
     * consumed on a successful sign-in.
     */
    recoveryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
      .optional(),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * The refresh token itself travels in an HttpOnly cookie, never in the body — a
 * body-borne refresh token is readable by any XSS payload on the page.
 */
export const refreshSchema = z.object({}).strict();

/**
 * Asking for a password reset link (SRS §4).
 *
 * Only the address, and the response says nothing about whether it matched. A
 * "no such account" reply here would be an easier customer-list oracle than the
 * login form, because it needs no password guess at all.
 */
export const passwordResetRequestSchema = z.object({ email: emailSchema }).strict();
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

/** 32 random bytes as base64url — see AuthTokenService. */
const authTokenSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]+$/, ERROR.VALIDATION_TOKEN_MALFORMED);

/**
 * Choosing the new password.
 *
 * Reuses `passwordSchema`, so the 12-character floor applies identically here and at
 * registration. A reset form with a looser rule is the standard way a password policy
 * quietly stops being one.
 */
export const passwordResetConfirmSchema = z
  .object({ token: authTokenSchema, password: passwordSchema })
  .strict();
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;

export const emailVerificationConfirmSchema = z
  .object({ token: authTokenSchema })
  .strict();
export type EmailVerificationConfirmInput = z.infer<
  typeof emailVerificationConfirmSchema
>;

export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: emailSchema,
  role: z.enum([
    'customer',
    'partner',
    'support_agent',
    'finance_officer',
    'operations_manager',
    'super_admin',
  ]),
  preferredLocale: localeSchema,
  permissions: z.array(z.string()),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: authUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/**
 * Staff management (M-5).
 *
 * `role` is validated against the closed set of staff roles rather than accepted as a
 * string: an unvalidated role would be written straight into a `user_role` column and
 * a typo would produce an account whose permissions resolve to nothing — visible in
 * the console, unable to do anything, and confusing to diagnose.
 */
export const STAFF_ROLE_VALUES = [
  'support_agent',
  'finance_officer',
  'operations_manager',
  'super_admin',
] as const;

export const staffInviteSchema = z
  .object({
    email: z.string().email().max(320),
    role: z.enum(STAFF_ROLE_VALUES),
    locale: z.enum(['ar', 'en', 'de']).optional(),
  })
  .strict();
export type StaffInviteInput = z.infer<typeof staffInviteSchema>;

export const staffRoleChangeSchema = z
  .object({ role: z.enum(STAFF_ROLE_VALUES) })
  .strict();
export type StaffRoleChangeInput = z.infer<typeof staffRoleChangeSchema>;

export const staffStatusSchema = z
  .object({ status: z.enum(['active', 'suspended']) })
  .strict();
export type StaffStatusInput = z.infer<typeof staffStatusSchema>;

/**
 * Accepting an invitation. Reuses `passwordSchema`, so the floor that applies at
 * registration applies to the accounts with the most access too — the one place a
 * looser rule would be least defensible.
 */
export const staffInvitationAcceptSchema = z
  .object({ token: authTokenSchema, password: passwordSchema })
  .strict();
export type StaffInvitationAcceptInput = z.infer<typeof staffInvitationAcceptSchema>;
