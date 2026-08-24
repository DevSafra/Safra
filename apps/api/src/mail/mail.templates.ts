import { compose } from './bilingual.js';
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
  return {
    to: input.to,
    ...compose((m) => m.passwordReset, input.locale, {
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
  return {
    to: input.to,
    ...compose((m) => m.emailVerification, input.locale, {
      url: input.url,
      expiresInHours: input.expiresInHours,
    }),
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
  return {
    to: input.to,
    ...compose((m) => m.accountExists, input.locale, {
      signInUrl: input.signInUrl,
      resetUrl: input.resetUrl,
    }),
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
  return {
    to: input.to,
    /*
      The values are a FUNCTION of the block's own language, not a fixed record.

      `roleLabel` comes from the catalogue, so a record computed once would put the Arabic word
      «مدير عمليات» inside the English block — the exact defect this rule exists to prevent,
      arriving one layer down. The function form resolves it per block.
    */
    ...compose(
      (m) => m.staffInvitation,
      input.locale,
      (m) => ({
        url: input.url,
        /* Falls back to the code: an unnamed role is an obvious gap, an empty one is a broken email. */
        roleLabel: m.roles[input.role] ?? input.role,
        expiresInHours: input.expiresInHours,
      }),
    ),
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
  return {
    to: input.to,
    ...compose((m) => m.partnerApplicationReceived, input.locale, {
      reference: input.reference,
      url: input.url,
    }),
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
  return {
    to: input.to,
    ...compose((m) => m.partnerApplicationRejected, input.locale, {
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
  return {
    to: input.to,
    ...compose((m) => m.partnerLoginCode, input.locale, {
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

/**
 * Inviting somebody to work FOR a partner (Bashar, 2026-08-23).
 *
 * Names the business, because the recipient did not ask for this: somebody at a hotel typed their
 * address into a staff screen, and a link arriving with no context reads as phishing. It carries
 * no reference number — an employee has no relationship with SAFRA to quote one about.
 */
export function partnerEmployeeInvitationMail(input: {
  to: string;
  partnerName: string;
  url: string;
  hours: number;
  locale: string;
}): OutgoingMail {
  return {
    to: input.to,
    ...compose((m) => m.partnerEmployeeInvitation, input.locale, {
      partnerName: input.partnerName,
      url: input.url,
      hours: input.hours,
    }),
  };
}

export function partnerInvitationMail(input: {
  to: string;
  reference: string;
  url: string;
  locale: string;
  expiresInHours: number;
}): OutgoingMail {
  return {
    to: input.to,
    ...compose((m) => m.partnerInvitation, input.locale, {
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
  return {
    to: input.to,
    ...compose((m) => m.partnerApproved, input.locale, {
      reference: input.reference,
      url: input.url,
    }),
  };
}

export function partnerContractAwaitingSignatureMail(input: {
  to: string;
  reference: string;
  url: string;
  locale: string;
}): OutgoingMail {
  return {
    to: input.to,
    ...compose((m) => m.partnerContractAwaitingSignature, input.locale, {
      reference: input.reference,
      url: input.url,
    }),
  };
}

/**
 * The partner's own copy of a contract that BOTH parties signed in person (Bashar, 2026-08-23).
 *
 * To the PARTNER, so it carries no console URL and speaks to them directly. It exists because a
 * joint upload is the only path where a contract becomes binding without the partner touching the
 * platform: they signed a sheet of paper across a desk and left. Every other route to `active` is
 * one the partner performed themselves and already has the file from.
 *
 * It does not attach the PDF. The document is behind the partner's own authenticated download, and
 * a signed commercial agreement is not something to put in an unencrypted mailbox — the link is
 * the copy, and it is a link to a page that asks who they are.
 */
export function partnerContractCountersignedMail(input: {
  to: string;
  reference: string;
  url: string;
  locale: string;
}): OutgoingMail {
  return {
    to: input.to,
    ...compose((m) => m.partnerContractCountersigned, input.locale, {
      reference: input.reference,
      url: input.url,
    }),
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
  return {
    to: input.to,
    ...compose((m) => m.partnerContractReturned, input.locale, {
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
  return {
    to: input.to,
    ...compose((m) => m.partnerDocumentsComplete, input.locale, {
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
  return {
    to: input.to,
    /* Per-block values — the KIND is catalogue copy; see `staffInvitationMail` for why. */
    ...compose(
      (m) => m.partnerContractReady,
      input.locale,
      (m) => ({
        partner: input.partner,
        kind: m.contractKinds[input.kind] ?? input.kind,
        url: input.url,
      }),
    ),
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
  return {
    to: input.to,
    ...compose((m) => m.reviewReceived, input.locale, {
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
  return {
    to: input.to,
    ...compose((m) => m.giftCardPurchased, input.locale, {
      reference: input.reference,
      code: input.code,
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
  return {
    to: input.to,
    ...compose((m) => m.giftCardReceived, input.locale, {
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
  return {
    to: input.to,
    ...compose((m) => m.reviewReplied, input.locale, {
      property: input.property,
      url: input.url,
    }),
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
  return {
    to: input.to,
    ...compose((m) => m.supportReplied, input.locale, {
      reference: input.reference,
      url: input.url,
    }),
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
  return {
    to: input.to,
    ...compose((m) => m.bookingNeedsAction, input.locale, {
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
  return {
    to: input.to,
    ...compose((m) => m.waiting, input.locale, {
      url: input.url,
    }),
  };
}

/**
 * "Your account has been disabled", and its counterpart.
 *
 * ## Why the person is told at all
 *
 * Bashar, 2026-08-23: *"When I set the status to غير نشط then the employee should not be able to
 * login with his account… The employee should get a notification per email about that."*
 *
 * Without it, a disabled account is indistinguishable from a broken one. The sign-in refusal is
 * deliberately GENERIC — `AuthService.login` answers a suspended account exactly as it answers a
 * wrong password, so that a suspended address cannot be confirmed by probing — which is right, and
 * it means the screen can never explain. The email is the only place the person can be told, and
 * it is sent to an address we already know rather than revealed to whoever is typing.
 *
 * ## What it says, and what it does not
 *
 * It does not say WHO disabled the account or why. That is a conversation with an administrator,
 * and a reason typed into a console field is not written for the person it is about. It does say
 * the account still exists, because "disabled" and "deleted" are the same event from the outside
 * and only one of them is worth panicking about.
 *
 * Reinstatement is sent too. Somebody who was told they were locked out and then silently let back
 * in learns to distrust both messages.
 */
export function staffSuspendedMail(input: { to: string; locale: string }): OutgoingMail {
  return { to: input.to, ...compose((m) => m.staffSuspended, input.locale) };
}

/**
 * Reinstatement carries a LINK and suspension does not, and that asymmetry is the point.
 *
 * Somebody let back in can act — the link takes them to the console and saves them finding it.
 * Somebody locked out cannot, and the only place a link could send them is the sign-in screen,
 * which by design answers a suspended account exactly as it answers a wrong password. A link to a
 * door that will not open and cannot say why is worse than no link.
 */
export function staffReinstatedMail(input: {
  to: string;
  locale: string;
  url: string;
}): OutgoingMail {
  return {
    to: input.to,
    ...compose((m) => m.staffReinstated, input.locale, { url: input.url }),
  };
}

/**
 * "Your partner account has been suspended", and the sentence that matters is the third one.
 *
 * A suspended partner's first fear is that their guests have been cancelled on. Bashar's rule is
 * explicit that confirmed bookings continue and existing guests are not disrupted — so the notice
 * says so, in bold, above the things that ARE blocked. Without it this is a message that reads as
 * "your business has stopped", which is not what happened.
 *
 * Carries a LINK, and `staffSuspended` deliberately does not — the difference is whether the door
 * opens. A suspended staff account cannot sign in, so the only link available would be a sign-in
 * screen that refuses them and, by design, cannot say why. A suspended PARTNER signs in, reads this
 * reason on their own dashboard, and can raise a support thread from it. Sending them there is the
 * most useful thing the message can do.
 */
export function partnerSuspendedMail(input: {
  to: string;
  locale: string;
  reason: string;
  date: string;
  url: string;
}): OutgoingMail {
  return {
    to: input.to,
    ...compose((m) => m.partnerSuspended, input.locale, {
      reason: input.reason,
      date: input.date,
      url: input.url,
    }),
  };
}

/**
 * "A warning has been issued on your account."
 *
 * ## What it says that the record does not
 *
 * Three facts a warned partner otherwise has to guess at, and each was chosen because guessing
 * wrong is expensive: a warning carries **no charge**, it does **not** affect ranking (Bashar's
 * standing rule, and the one thing a partner assumes has happened), and confirmed bookings stand.
 * Without them a warning reads as an unnamed penalty of unknown size.
 *
 * `note` is the warning TEXT — written by an operator for this reader, under a field labelled
 * «يقرأه الشريك». The staff-only fields never come near this template.
 */
export function partnerWarnedMail(input: {
  to: string;
  locale: string;
  note: string;
  date: string;
  url: string;
}): OutgoingMail {
  return {
    to: input.to,
    ...compose((m) => m.partnerWarned, input.locale, {
      note: input.note,
      date: input.date,
      url: input.url,
    }),
  };
}

/**
 * "A fine has been charged to your account."
 *
 * `amount` arrives already formatted with its currency — the caller has the currency code and this
 * template must not invent a format for money. It states that a fine does not affect ranking for
 * the same reason the warning does: it is the assumption a partner makes.
 */
export function partnerFinedMail(input: {
  to: string;
  locale: string;
  amount: string;
  reason: string;
  date: string;
  url: string;
}): OutgoingMail {
  return {
    to: input.to,
    ...compose((m) => m.partnerFined, input.locale, {
      amount: input.amount,
      reason: input.reason,
      date: input.date,
      url: input.url,
    }),
  };
}

/**
 * "Your partner account has been reinstated."
 *
 * The one notice in this group that is good news, and it still carries a reason: lifting an
 * enforcement action is a decision with consequences, and "who decided this was over, and why" is
 * asked exactly as often as why it began.
 *
 * It says the frozen payouts were HELD rather than cancelled, because a partner who watched
 * transfers stop has no way to know which of the two happened.
 */
export function partnerUnsuspendedMail(input: {
  to: string;
  locale: string;
  reason: string;
  date: string;
  url: string;
}): OutgoingMail {
  return {
    to: input.to,
    ...compose((m) => m.partnerUnsuspended, input.locale, {
      reason: input.reason,
      date: input.date,
      url: input.url,
    }),
  };
}

/**
 * "A fine on your account has been waived."
 *
 * > Bashar, 2026-08-24: *"The affected partner must be notified that the fine was waived."*
 *
 * The copy states the thing the ledger does and a partner would not otherwise know: the original
 * violation STAYS on the record, with the waiver recorded beside it. Somebody told only that a fine
 * was cancelled reasonably assumes the whole matter is gone — and then finds the violation still
 * there and reads it as the platform going back on a decision. Saying "we do not delete the record,
 * we add to it" is the same principle the ledger implements, in a sentence a person can read.
 */
export function partnerFineWaivedMail(input: {
  to: string;
  locale: string;
  amount: string;
  reason: string;
  date: string;
  url: string;
}): OutgoingMail {
  return {
    to: input.to,
    ...compose((m) => m.partnerFineWaived, input.locale, {
      amount: input.amount,
      reason: input.reason,
      date: input.date,
      url: input.url,
    }),
  };
}
