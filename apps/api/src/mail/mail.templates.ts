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
  /**
   * The role CODE — `operations_manager` — not a label.
   *
   * It used to be a label, built by the caller as `role.replace(/_/g, ' ')`, which put an English
   * phrase inside an Arabic and a German sentence: «تمت دعوتك … بصفة: operations manager». The
   * word belongs to the reader's language, so it is resolved here, where the locale is known.
   */
  role: string;
  locale: string;
  expiresInHours: number;
}): OutgoingMail {
  const messages = emailMessages(resolveLocale(input.locale));
  const copy = messages.staffInvitation;

  return {
    to: input.to,
    subject: copy.subject,
    text: fill(copy.body, {
      url: input.url,
      /* Falls back to the code: an unnamed role is an obvious gap, an empty one is a broken email. */
      roleLabel: messages.roles[input.role] ?? input.role,
      expiresInHours: input.expiresInHours,
    }),
  };
}

/**
 * We have your partnership request — the acknowledgement for step 1.
 *
 * Carries the REFERENCE and nothing about the queue. An applicant who is told where they sit in a
 * review order will chase that position; what they actually need is the number to quote and the
 * knowledge that a phone call is the next thing to happen.
 */
export function partnerApplicationReceivedMail(input: {
  to: string;
  reference: string;
  url: string;
  locale: string;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).partnerApplicationReceived;

  return {
    to: input.to,
    subject: fill(copy.subject, { reference: input.reference }),
    text: fill(copy.body, { reference: input.reference, url: input.url }),
  };
}

/**
 * A request that will not proceed, with the reason the reviewer gave.
 *
 * The reason is the staff member's own words, so it is `sensitive: false` but still worth naming:
 * it is written on a console screen and read by the applicant, which is exactly the kind of text
 * that gets used to say more than it should. The screen says so above the field.
 */
export function partnerApplicationRejectedMail(input: {
  to: string;
  reference: string;
  reason: string;
  url: string;
  locale: string;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).partnerApplicationRejected;

  return {
    to: input.to,
    subject: fill(copy.subject, { reference: input.reference }),
    text: fill(copy.body, {
      reference: input.reference,
      reason: input.reason,
      url: input.url,
    }),
  };
}

/**
 * The account hand-over — step 4, and the one message in the flow that carries authority.
 *
 * A LINK, never a password. Bashar's step 4 said "email + password"; a password in an inbox is a
 * credential that outlives its usefulness and is readable by anybody who ever reaches that
 * mailbox, which §1 forbids. A single-use link that expires does the same job and can be revoked.
 *
 * ## NOT `sensitive`, and that is deliberate
 *
 * It was, briefly. `sensitive` withholds the body from the no-transport branch — which is the only
 * branch that can run without SMTP, i.e. every development machine — and that made the one flow
 * nobody can test without a mail server. `MailService` states the rule it is applying there: the
 * body is logged because a developer needs the link and the branch cannot run in production.
 *
 * The three templates that DO set it carry a gift-card code, which is spendable cash and is a
 * secret relative to its own inbox. An invitation is not: it is single-use, it expires in 72
 * hours, and it goes to the same mailbox as the password reset — which is not marked either.
 */
/**
 * The six-digit code a partner needs to finish signing in (Bashar, 2026-08-20).
 *
 * No link, deliberately — see `LINKLESS` in `completeness.test.ts`. A code mail that also carries
 * a link is the exact shape of the phishing mail impersonating it.
 */
export function partnerLoginCodeMail(input: {
  to: string;
  code: string;
  locale: string;
  expiresInMinutes: number;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).partnerLoginCode;

  return {
    to: input.to,
    subject: copy.subject,
    text: fill(copy.body, {
      code: input.code,
      expiresInMinutes: input.expiresInMinutes,
    }),
    /**
     * The body is a CREDENTIAL, so it is withheld from the log.
     *
     * With no SMTP transport configured — every local environment — `MailService` writes the whole
     * body to the log so a developer can follow the link. For this mail that would put a live
     * sign-in code in a log file, which is the one thing rule 1 says a log must never carry. The
     * code is read from the mail catcher instead.
     */
    sensitive: true,
  };
}

export function partnerInvitationMail(input: {
  to: string;
  reference: string;
  url: string;
  locale: string;
  expiresInHours: number;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).partnerInvitation;

  return {
    to: input.to,
    subject: copy.subject,
    text: fill(copy.body, {
      reference: input.reference,
      url: input.url,
      expiresInHours: input.expiresInHours,
    }),
  };
}

/**
 * The partnership contract is uploaded and waiting to be signed — the other half of step 4.
 *
 * A LINK to the dashboard, not the PDF. An attachment would put a commercial agreement in an
 * inbox that may be shared, and the dashboard already authenticates the reader and keeps every
 * superseded version — which is the record that answers "which terms were in force that day".
 */
/**
 * A partner has sent every document, and a reviewer has to look (Bashar, 2026-08-21).
 *
 * ## To STAFF, not to the partner
 *
 * The only outbound mail in this file whose recipient is one of ours, which is why the reference
 * and the console URL are safe to put in it and why the copy speaks about the partner in the third
 * person. The partner already knows what they sent; the person who does not is the one who has to
 * act on it.
 *
 * ## What it deliberately does not carry
 *
 * No document, no link to one, and no contact details. A verification document is an identity
 * document — the thing §14 is most careful with — and an email is the least controlled place it
 * could be. The mail carries a REFERENCE and a URL into the console, where the reader is
 * authenticated, permissioned and audited on every view. That is the whole design: the email is a
 * pointer, never a copy.
 */
/**
 * SAFRA has signed; the partner's copy is waiting (Bashar, 2026-08-21).
 *
 * Step 4 of «انضم كشريك», and the first half of a two-message exchange: this one goes OUT when
 * staff upload their hand-signed copy, and `partnerContractReturnedMail` comes back when the
 * partner uploads theirs.
 *
 * ## It says what to physically do
 *
 * Signing is on paper — electronic signatures are not accepted in Syria — so "your contract is
 * ready" is not enough of an instruction. Download, sign by hand, upload again: three verbs, in
 * the order they happen, because a partner who reads this on a phone at night needs to know
 * whether a printer is involved.
 *
 * Carries a URL into the portal and nothing else. The contract is not attached: it is a document
 * the partner is authenticated to fetch, and an email attachment is a copy nobody can revoke.
 */
/**
 * Verification is complete and the portal is open (Bashar, 2026-08-21).
 *
 * The last message of «انضم كشريك» and the first one a partner reads as an approved partner. It
 * therefore says what is now POSSIBLE — units, prices, availability, photographs, submitting a
 * listing — rather than only that a status changed. A partner who is told "you are approved" and
 * left to discover what that unlocked will open a support ticket to ask.
 *
 * Sent on the `approve` decision only. A rejection has its own conversation, and a partner told
 * "the outcome is recorded" by an automated message would be worse than being telephoned.
 */
export function partnerApprovedMail(input: {
  to: string;
  reference: string;
  url: string;
  locale: string;
}): OutgoingMail {
  const messages = emailMessages(resolveLocale(input.locale));
  const copy = messages.partnerApproved;

  return {
    to: input.to,
    subject: fill(copy.subject, { reference: input.reference }),
    text: fill(copy.body, { url: input.url }),
  };
}

export function partnerContractAwaitingSignatureMail(input: {
  to: string;
  reference: string;
  url: string;
  locale: string;
}): OutgoingMail {
  const messages = emailMessages(resolveLocale(input.locale));
  const copy = messages.partnerContractAwaitingSignature;

  return {
    to: input.to,
    subject: fill(copy.subject, { reference: input.reference }),
    text: fill(copy.body, { url: input.url }),
  };
}

/**
 * The partner has signed and returned it; the contract is in force.
 *
 * To STAFF, so the reference and the console URL are safe to carry, and the partner is spoken of
 * in the third person. Sent to every active super admin, the same recipients and the same
 * reasoning as `partnerDocumentsCompleteMail`: this is the message that says the last thing
 * standing before approval is done.
 */
export function partnerContractReturnedMail(input: {
  to: string;
  reference: string;
  displayName: string;
  url: string;
  locale: string;
}): OutgoingMail {
  const messages = emailMessages(resolveLocale(input.locale));
  const copy = messages.partnerContractReturned;

  return {
    to: input.to,
    subject: fill(copy.subject, { reference: input.reference }),
    text: fill(copy.body, {
      reference: input.reference,
      displayName: input.displayName,
      url: input.url,
    }),
  };
}

export function partnerDocumentsCompleteMail(input: {
  to: string;
  reference: string;
  displayName: string;
  documentCount: number;
  url: string;
  locale: string;
}): OutgoingMail {
  const messages = emailMessages(resolveLocale(input.locale));
  const copy = messages.partnerDocumentsComplete;

  return {
    to: input.to,
    subject: fill(copy.subject, { reference: input.reference }),
    text: fill(copy.body, {
      reference: input.reference,
      displayName: input.displayName,
      documentCount: input.documentCount,
      url: input.url,
    }),
  };
}

export function partnerContractReadyMail(input: {
  to: string;
  partner: string;
  kind: string;
  url: string;
  locale: string;
}): OutgoingMail {
  const messages = emailMessages(resolveLocale(input.locale));
  const copy = messages.partnerContractReady;

  return {
    to: input.to,
    subject: fill(copy.subject, { partner: input.partner }),
    text: fill(copy.body, {
      /* The KIND in the reader's language, for the same reason the staff role is — see above. */
      kind: messages.contractKinds[input.kind] ?? input.kind,
      url: input.url,
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

/**
 * The gift card code, to the person who bought it (Bashar, 2026-08-18).
 *
 * ## This is the only copy
 *
 * `gift_cards` stores `code_hash` and `code_last4` and nothing else, so the plaintext exists for the
 * length of one request and is then unrecoverable — by us as much as by anyone. The body says so
 * plainly, because "we cannot send it again" is the difference between a customer filing it safely
 * and a customer assuming they can ask.
 *
 * ## A code is cash, and this puts it in an inbox
 *
 * That is inherent to a gift card rather than a flaw in the delivery: a code nobody can read is not
 * a gift. What follows from it is that this template must never be reused to send a code to anyone
 * who did not buy it — the caller passes `to`, and the only correct value is the purchaser's own
 * address. A card bought FOR somebody else is a separate decision about delivering a gift.
 */
export function giftCardPurchasedMail(input: {
  to: string;
  locale: string;
  code: string;
  reference: string;
  amount: string;
  url: string;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).giftCardPurchased;

  return {
    to: input.to,
    subject: fill(copy.subject, { reference: input.reference }),
    text: fill(copy.body, {
      code: input.code,
      reference: input.reference,
      amount: input.amount,
      url: input.url,
    }),
    sensitive: true,
  };
}

/**
 * The gift itself, to the address the buyer named.
 *
 * ## Nobody's name appears in it
 *
 * The obvious version says "Rami has sent you a gift card". Both that name and the recipient's are
 * FREE TEXT a caller chose, and this mail goes from SAFRA to an address a caller also chose — which
 * is a content-injection page with postage. A profile called «سفرة: حسابك موقوف، اتصل بـ…» would
 * arrive looking exactly like us. The platform already refuses to put user-authored text in outbound
 * mail — a support reply carries a link and never the message — so this follows that, and the buyer
 * can tell the recipient who it is from by any other means.
 *
 * The cost is a slightly colder gift. The alternative is a phishing primitive that costs the price
 * of one card.
 */
export function giftCardReceivedMail(input: {
  to: string;
  locale: string;
  code: string;
  reference: string;
  amount: string;
  url: string;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).giftCardReceived;

  return {
    to: input.to,
    subject: copy.subject,
    text: fill(copy.body, {
      code: input.code,
      reference: input.reference,
      amount: input.amount,
      url: input.url,
    }),
    sensitive: true,
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

/**
 * The re-drive notice: something was waiting, and we cannot say exactly what.
 *
 * ## Why this template has to exist
 *
 * `docs/background-jobs-design.md` claims a total loss of Redis is survivable because the work can
 * be "re-driven from the database rows". Detection always worked — a `queued` row names exactly
 * what was lost — but RECONSTRUCTION could not be written as described, and the register recorded
 * that as an open gap against launch blocker 2.
 *
 * The reason is a deliberate design choice elsewhere: a `notifications` row carries no recipient, no
 * subject and no body, because every support agent can read that table. So the row says a partner
 * was to be told about a review, and cannot say WHICH review.
 *
 * Three of the four notices are in that position. Rather than downgrade the recovery claim to
 * "identifiable and unsendable", they are re-driven as this: a notice that says something is
 * waiting and links to the screen where it is. That is less than the original and considerably more
 * than silence, and it is honest about being a summary rather than pretending to be the first
 * message.
 *
 * `booking.needs_action` is the exception and is rebuilt in full — its `booking_id` is enough.
 */
export function notificationWaitingMail(input: {
  to: string;
  locale: string;
  url: string;
}): OutgoingMail {
  const copy = emailMessages(resolveLocale(input.locale)).waiting;

  return {
    to: input.to,
    subject: copy.subject,
    text: fill(copy.body, { url: input.url }),
  };
}
