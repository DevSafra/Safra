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
 * "You already have an account", sent when somebody tries to register an address that is taken.
 *
 * ## Why this email exists at all
 *
 * `POST /auth/register` used to answer `409 auth.email_taken`, which told anybody who asked whether
 * an address was registered — one request, no side effects, a perfect enumeration oracle. It now
 * answers the same generic success for every address, and the DIFFERENCE moves into the inbox,
 * where only the owner of the address can see it.
 *
 * ## What the copy has to do
 *
 * Two things at once. For the real owner who forgot they had signed up, it has to be useful: both
 * the sign-in and the password-reset links, because "I already have an account" and "I cannot
 * remember my password" arrive together.
 *
 * For the owner receiving it because a STRANGER tried their address, it has to be calming and
 * accurate — nothing has changed, nobody saw anything. An email that sounds like a breach notice
 * generates a support ticket and teaches people to ignore the next one.
 *
 * It deliberately does not say who tried, or from where. That would hand the owner an IP address
 * belonging to somebody who might simply have mistyped their own email.
 */
export function accountExistsMail(input: {
  to: string;
  signInUrl: string;
  resetUrl: string;
  locale: string;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).accountExists;

  return {
    to: input.to,
    subject: copy.subject,
    text: fill(copy.body, { signInUrl: input.signInUrl, resetUrl: input.resetUrl }),
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

/**
 * A guest has reviewed one of the partner's listings.
 *
 * The email says P-006 out loud. A partner learning about a review by email and finding no delete
 * button reads that as the product failing them; told in the same message that nobody can remove a
 * review — not the guest, not SAFRA — and that a reply is the answer, they know what to do with it.
 */
export function reviewReceivedMail(input: {
  to: string;
  locale: string;
  property: string;
  rating: number;
  url: string;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).reviewReceived;

  return {
    to: input.to,
    subject: fill(copy.subject, { property: input.property }),
    text: fill(copy.body, {
      property: input.property,
      rating: input.rating,
      url: input.url,
    }),
  };
}

/** The host has replied to a review the customer wrote. */
export function reviewRepliedMail(input: {
  to: string;
  locale: string;
  property: string;
  url: string;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).reviewReplied;

  return {
    to: input.to,
    subject: fill(copy.subject, { property: input.property }),
    text: fill(copy.body, { property: input.property, url: input.url }),
  };
}

/**
 * A booking is waiting for the partner's decision.
 *
 * Carries the DEADLINE, because the consequence of missing it is a fine and a score penalty
 * (§6.4). A notice that said only "you have a booking" would leave the partner to discover the
 * clock from the dashboard, and the whole point of the email is reaching somebody who is not
 * looking at the dashboard.
 */
/**
 * Staff have answered a support ticket.
 *
 * ## It carries a link and NOT the answer
 *
 * Every message body in a thread is stored REDACTED and the original is deliberately discarded
 * (`packages/db/src/schema/messaging.ts`). Putting the reply text in an email would recreate in an
 * inbox exactly what the redaction removed from the database — and an inbox is the one place the
 * platform cannot reach to correct it afterwards.
 *
 * So the notice is a pointer: the ticket's reference, and the URL of the thread. The body says out
 * loud that the text is not included, because a message that looks truncated reads as a fault, and
 * somebody who believes they have already read the answer never opens the thread.
 */
export function supportRepliedMail(input: {
  to: string;
  locale: string;
  reference: string;
  url: string;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).supportReplied;

  return {
    to: input.to,
    subject: fill(copy.subject, { reference: input.reference }),
    text: fill(copy.body, { reference: input.reference, url: input.url }),
  };
}

export function bookingNeedsActionMail(input: {
  to: string;
  locale: string;
  reference: string;
  property: string;
  checkIn: string;
  checkOut: string;
  deadline: string;
  url: string;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).bookingNeedsAction;

  return {
    to: input.to,
    subject: fill(copy.subject, { reference: input.reference }),
    text: fill(copy.body, {
      reference: input.reference,
      property: input.property,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      deadline: input.deadline,
      url: input.url,
    }),
  };
}
