import { z } from 'zod';

import { localeSchema, passwordSchema, phoneSchema } from './auth.js';
import { ERROR } from './error-codes.js';
import { pageQuerySchema } from './pagination.js';

/**
 * Applying to become a partner — «انضم كشريك» (Bashar, 2026-08-19).
 *
 * ## Signed in, not anonymous (Bashar, 2026-08-19)
 *
 * The page and the endpoint both require a session. That is what removes the hardest problem this
 * feature had: an application used to carry a typed email address, which is a CLAIM about a
 * mailbox nobody had checked, and acceptance had to be built so that a forged one cost the real
 * owner nothing.
 *
 * There is therefore **no `email` field here**. The address is the signed-in account's, read
 * server-side from the token — so "apply as somebody else" is not a request this schema can
 * express, rather than a request the service has to defend against.
 *
 * ## What it does NOT accept, and why that is the point
 *
 * No password, no role, no status, no account id, no partner type ID — a CODE, resolved
 * server-side against `partner_types`. The form creates a REQUEST, not an account: nothing here
 * could grant anybody anything.
 *
 * That is a deliberate reversal of `partnerRegisterSchema`, which took a password and created a
 * partner account outright. The flow Bashar specified puts a phone call and a super admin's
 * acceptance between the form and the account, so the form can no longer be the thing that
 * creates one.
 */
export const partnerApplicationSchema = z
  .object({
    /*
      Every rule carries an ERROR CODE, never a Zod default.

      Zod's own message is English prose — «Invalid input» — and this form renders its messages
      under the fields, so an Arabic applicant read English until 2026-08-19. A code is resolved
      by whoever is displaying it, in the language of the person reading (see `docs/i18n.md`).
    */
    /** The person to call. Step 2 of the flow is a human phoning them. */
    contactName: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(120, ERROR.VALIDATION_TOO_LONG),
    /*
      No `email`. It is the signed-in account's address — see the note above. A field here would
      let somebody signed in as themselves file a request against another person's mailbox.
    */
    phone: phoneSchema,

    /** The legal entity, as it appears on the commercial register (§8.1). */
    legalName: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(200, ERROR.VALIDATION_TOO_LONG),
    /** What customers would see. May differ from the legal name. */
    displayName: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(120, ERROR.VALIDATION_TOO_LONG),
    /** `accommodation`, `mobility`, … — validated against `partner_types`. */
    partnerTypeCode: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(40, ERROR.VALIDATION_TOO_LONG),
    citySlug: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(80, ERROR.VALIDATION_TOO_LONG),
    address: z
      .string()
      .trim()
      .min(4, ERROR.VALIDATION_REQUIRED)
      .max(300, ERROR.VALIDATION_TOO_LONG),

    /**
     * How many properties they say they have.
     *
     * Optional and capped: a sizing hint for the call, never a promise, and never a number the
     * platform acts on. The cap is there because it is a free-text number on a public form.
     */
    propertyCount: z.coerce.number().int().min(1).max(10_000).optional(),
    /** `https://…`, so a reviewer can click it. Never rendered as a link without checking. */
    website: z
      .string()
      .trim()
      .url(ERROR.VALIDATION_URL_INVALID)
      .max(300, ERROR.VALIDATION_TOO_LONG)
      .optional(),
    /** Anything else they want the reviewer to know, before the call. */
    message: z.string().trim().max(2000, ERROR.VALIDATION_TOO_LONG).optional(),

    /**
     * Which language to write back in.
     *
     * Still asked, even though the account has a `preferred_locale`: a person browsing in Arabic
     * may want a partnership contract discussed in German, and this is a business relationship
     * rather than a browsing preference. It does not change the account's own setting.
     */
    preferredLocale: localeSchema.default('ar'),
  })
  .strict();

export type PartnerApplicationInput = z.infer<typeof partnerApplicationSchema>;

/** What the public form gets back: a reference to quote, and nothing about the queue. */
export interface PartnerApplicationReceipt {
  readonly reference: string;
}

/** The statuses a request moves through. Mirrors `partner_application_status` in the schema. */
export const PARTNER_APPLICATION_STATUSES = [
  'submitted',
  'contacted',
  'accepted',
  'rejected',
] as const;

export type PartnerApplicationStatus = (typeof PARTNER_APPLICATION_STATUSES)[number];

/**
 * The console's queue.
 *
 * `pageQuerySchema` rather than a cursor: this is a staff registry with a page NUMBER, which is
 * the documented console exception in `pagination.ts`.
 */
export const partnerApplicationListQuerySchema = pageQuerySchema
  .extend({
    status: z.enum(PARTNER_APPLICATION_STATUSES).optional(),
    /** Reference, business name or email. Trimmed and capped like every other registry search. */
    q: z.string().trim().max(120).optional(),
  })
  .strict();

export type PartnerApplicationListQuery = z.infer<
  typeof partnerApplicationListQuerySchema
>;

/**
 * Recording that the applicant was CALLED — step 2.
 *
 * A status of its own rather than a note on the row, because a queue that cannot show which
 * requests have already been rung makes two people ring the same one.
 */
export const partnerApplicationContactSchema = z
  .object({ notes: z.string().trim().min(2).max(2000) })
  .strict();

export type PartnerApplicationContactInput = z.infer<
  typeof partnerApplicationContactSchema
>;

/**
 * Accepting a request — step 3, and the step that creates something.
 *
 * No account and no address are named here. The request already records WHICH ACCOUNT filed it,
 * proven by the session it was filed from; letting the reviewer name one would turn "accept this
 * request" into "make an account of my choosing a partner", which is a different and much more
 * dangerous action wearing the same label in the audit log.
 */
export const partnerApplicationAcceptSchema = z
  .object({ notes: z.string().trim().max(2000).optional() })
  .strict();

export type PartnerApplicationAcceptInput = z.infer<
  typeof partnerApplicationAcceptSchema
>;

/** Rejecting a request. The reason is REQUIRED — a decision nobody can explain is not one. */
export const partnerApplicationRejectSchema = z
  .object({ notes: z.string().trim().min(2).max(2000) })
  .strict();

export type PartnerApplicationRejectInput = z.infer<
  typeof partnerApplicationRejectSchema
>;

/**
 * Redeeming a partner invitation: the recipient sets their first password.
 *
 * The token travels in the BODY rather than the path so it does not reach a server access log or
 * a `Referer` header. It is the whole authentication for this call, which is why it is 256 bits
 * of randomness, single-use and short-lived.
 */
export const partnerInvitationAcceptSchema = z
  .object({
    token: z.string().trim().min(20).max(200),
    password: passwordSchema,
  })
  .strict();

export type PartnerInvitationAcceptInput = z.infer<typeof partnerInvitationAcceptSchema>;
