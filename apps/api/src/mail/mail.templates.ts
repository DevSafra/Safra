import { emailMessages, fill, resolveLocale } from '@safra/i18n';

import type { OutgoingMail } from './mail.service.js';

/**
 * Transactional email, rendered from the catalogue in `@safra/i18n`.
 *
 * ## What this file is now
 *
 * Three functions that each take what the message needs, pick the recipient's locale, and fill
 * one template. The COPY is not here — it moved to `@safra/i18n/messages/email/{ar,en,de}.ts`,
 * where all three languages sit beside each other and a missing one is a failing test rather
 * than a customer reading Arabic.
 *
 * It used to hold the wording for all three locales inline, as concatenated template literals
 * inside each function. That worked, and it meant "add a language" required reading three
 * function bodies and knowing which of the string fragments were copy and which were structure.
 *
 * Plain text only, deliberately. An HTML template that has not been tested across clients
 * renders worse than text in the ones that matter, and these messages carry a single link each.
 *
 * Kept out of `MailService` so the service stays about DELIVERY.
 *
 * ## `resolveLocale`, not a local `pick`
 *
 * The locale arrives as `users.preferred_locale`, a `text` column with no constraint. One helper
 * decides what an unrecognised value means, and it is the same helper the customer app uses on a
 * URL segment — so an account whose column says `fr` gets Arabic here and Arabic there.
 */

/**
 * How long the customer has, stated in the email itself.
 *
 * A reset link that has quietly expired is one of the most common support contacts on any
 * platform, and it is entirely avoidable by saying so up front.
 */
export function passwordResetMail(input: {
  to: string;
  url: string;
  locale: string;
  expiresInMinutes: number;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).passwordReset;

  return {
    to: input.to,
    subject: copy.subject,
    text: fill(copy.body, {
      url: input.url,
      expiresInMinutes: input.expiresInMinutes,
    }),
  };
}

export function emailVerificationMail(input: {
  to: string;
  url: string;
  locale: string;
  expiresInHours: number;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).emailVerification;

  return {
    to: input.to,
    subject: copy.subject,
    text: fill(copy.body, { url: input.url, expiresInHours: input.expiresInHours }),
  };
}

/**
 * A staff invitation.
 *
 * The copy deliberately says what the account is FOR and who to contact if it is unexpected. An
 * unexplained "set your password" email to a work address is indistinguishable from a phishing
 * attempt, and the people receiving this one have privileged access — they are exactly the
 * population worth training not to click unexplained links.
 */
export function staffInvitationMail(input: {
  to: string;
  url: string;
  roleLabel: string;
  locale: string;
  expiresInHours: number;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).staffInvitation;

  return {
    to: input.to,
    subject: copy.subject,
    text: fill(copy.body, {
      url: input.url,
      roleLabel: input.roleLabel,
      expiresInHours: input.expiresInHours,
    }),
  };
}
