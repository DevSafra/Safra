import { z } from 'zod';

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
  .min(12, 'Password must be at least 12 characters.')
  .max(256, 'Password must be at most 256 characters.');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('A valid email address is required.')
  .max(254);

/**
 * E.164. Syria, Jordan and Lebanon all use country codes, and WhatsApp
 * notifications (§10.2) require a normalised international number.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    'Phone must be in international format, e.g. +963912345678.',
  );

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
      .regex(/^\d{6}$/, 'Authenticator code must be 6 digits.')
      .optional(),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * The refresh token itself travels in an HttpOnly cookie, never in the body — a
 * body-borne refresh token is readable by any XSS payload on the page.
 */
export const refreshSchema = z.object({}).strict();

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
