import { isValidPhoneNumber } from 'libphonenumber-js/max';
import { z } from 'zod';
import { ERROR } from './error-codes.js';
import {
  PASSWORD_RULES,
  passwordEchoesIdentity,
  passwordWeakness,
} from './password-strength.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password-length.js';

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };

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
  .min(PASSWORD_MIN_LENGTH, ERROR.VALIDATION_PASSWORD_TOO_SHORT)
  .max(PASSWORD_MAX_LENGTH, ERROR.VALIDATION_PASSWORD_TOO_LONG)
  /*
    And it must not be one of the ones people actually choose.

    Length was the whole policy until 2026-08-14, so `aaaaaaaaaaaa` and `123456789012` were accepted
    on a platform holding wallet balances and payout accounts. `passwordWeakness` is the blocklist
    half of NIST SP 800-63B — the half this policy had skipped while adopting the "length beats
    composition" half, which is kept.

    On the SCHEMA rather than at a call site, so every route that accepts a password inherits it:
    registration, reset, change, staff invitation, partner registration. A check added per endpoint
    is a check the next endpoint forgets.

    `superRefine` rather than `refine` because the reason must reach the reader — "pick a different
    one" and "stop repeating a character" are different instructions, and a single boolean would
    collapse them into one unhelpful sentence.
  */
  .superRefine((password, context) => {
    /*
      The composition checklist first, because it is what the meter beside the field is showing.

      A refusal for something the checklist has already ticked green would be the one thing worse
      than no meter: `PASSWORD_RULES` is the single definition both read, so they cannot disagree.
    */
    /*
      `length` is EXCLUDED here, because `.min()` above already owns it and says it better.

      Left in, a ten-character `Shortpass1!` produced two issues — "at least 12 characters" and the
      whole composition sentence — and the second won, so somebody one character short was told to
      add a capital they already had. The meter still SHOWS length, because a checklist that omitted
      the most important requirement would be the wrong thing to look at.
    */
    if (PASSWORD_RULES.some((rule) => rule.id !== 'length' && !rule.test(password))) {
      context.addIssue({
        code: 'custom',
        message: ERROR.VALIDATION_PASSWORD_COMPOSITION,
      });

      return;
    }

    /*
      Then the blocklist, which is what keeps the checklist honest. `Password1!` ticks every box
      above and is still one of the most-guessed passwords there is.
    */
    const weakness = passwordWeakness(password);

    if (weakness) context.addIssue({ code: 'custom', message: weakness });
  });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email(ERROR.VALIDATION_EMAIL_INVALID)
  .max(254);

/**
 * E.164, and a number that actually EXISTS (Bashar, 2026-08-18: "must be correct").
 *
 * The regex alone accepted `+963912345678` — right shape, twelve digits, and no such Syrian
 * range: 91x is not allocated. That matters beyond tidiness: this number is what a partner is given to
 * reach a guest, and what WhatsApp notifications (§10.2) are sent to. A booking held against a
 * number that cannot ring is a booking nobody can rescue.
 *
 * ## Two codes, because they are two different mistakes
 *
 * `phone_format` means the shape is wrong — no `+`, letters, far too long. `phone_invalid` means
 * the shape is right and the NUMBER is not: an unallocated prefix, or the wrong length for that
 * country. The second needs a different sentence, because "use international format" is useless
 * advice to somebody who already did.
 *
 * ## Why `max` metadata and not `mobile`
 *
 * `mobile` would additionally reject every landline, and some customers have only a landline —
 * refusing their registration to protect a WhatsApp channel is the wrong trade. `max` asks the
 * narrower question this schema should ask: is this a real number in that country, of any type.
 *
 * `min` was not enough: it validates little more than length, and passed `+963912345678`.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, ERROR.VALIDATION_PHONE_FORMAT)
  .refine(isValidPhoneNumber, ERROR.VALIDATION_PHONE_INVALID);

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

/**
 * How a customer chooses to be addressed.
 *
 * ## Required, and «أفضّل عدم الإفصاح» is one of the answers
 *
 * Bashar asked for it to be required (2026-08-14). Required means a CHOICE must be made — it does
 * not mean the choice must be male or female, and `undisclosed` stays a first-class value rather
 * than a polite way of leaving the field blank.
 *
 * That distinction is the whole design. A required field with only two answers forces somebody to
 * state something untrue about themselves, which produces worse data than no data and is a poor
 * thing to do besides. A required field with three lets the answer "I would rather not say" be
 * RECORDED, which is different from never having been asked and is what the enum stores.
 *
 * Nothing in the platform branches on it; it exists so somebody can be addressed correctly, which
 * is what keeps collecting it proportionate under data minimisation.
 */
export const genderSchema = z.enum(['male', 'female', 'undisclosed']);
export type Gender = z.infer<typeof genderSchema>;

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    fullName: z.string().trim().min(2).max(120),
    phone: phoneSchema,
    /* Required: a choice must be made, and `undisclosed` is one of the choices. */
    gender: genderSchema,
    preferredLocale: localeSchema.default('ar'),
  })
  .strict()
  /*
    The one check that needs the whole object.

    A password containing your own email address is the first one an attacker holding a leaked
    address list writes down. `passwordSchema` cannot see it — a schema for a string knows only the
    string — so it is applied here, where the email and the name are in scope.

    The issue is attached to `password`, not to the object, so the message lands under the field the
    person has to change rather than at the top of the form.
  */
  .superRefine((value, context) => {
    if (
      passwordEchoesIdentity(value.password, { email: value.email, name: value.fullName })
    ) {
      context.addIssue({
        code: 'custom',
        path: ['password'],
        message: ERROR.VALIDATION_PASSWORD_CONTAINS_IDENTITY,
      });
    }
  });
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
    /**
     * The code EMAILED to a partner, since 2026-08-20 (Bashar).
     *
     * Six digits like `totpCode` and validated the same way, but a separate field: the two are
     * different secrets from different places, and one field would mean the server guessing which
     * the caller meant — the wrong guess being an attacker feeding a stale email code where an
     * authenticator was expected.
     */
    emailCode: z
      .string()
      .regex(/^\d{6}$/, ERROR.VALIDATION_CODE_SIX_DIGITS)
      .optional(),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Asking for another emailed code.
 *
 * It carries the PASSWORD, not just the address, and that is deliberate: a body with only an email
 * would let anybody post codes at a stranger's inbox all day. Proving the password first makes the
 * resend available to exactly the person who is already halfway through signing in.
 */
export const loginCodeResendSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(256) })
  .strict();
export type LoginCodeResendInput = z.infer<typeof loginCodeResendSchema>;

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
