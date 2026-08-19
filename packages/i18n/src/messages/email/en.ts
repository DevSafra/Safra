/** Transactional email copy in English. */
export const en = {
  passwordReset: {
    subject: 'Reset your SAFRA password',
    body: 'You asked to reset the password for your SAFRA account.\n\nOpen this link to choose a new one:\n{url}\n\nThe link expires in {expiresInMinutes} minutes and can be used once.\n\nIf you did not ask for this, ignore this email — nothing about your account has changed.\n\nThe SAFRA team',
  },
  emailVerification: {
    subject: 'Confirm your email address — SAFRA',
    body: 'Welcome to SAFRA.\n\nConfirm your email address with this link:\n{url}\n\nThe link expires in {expiresInHours} hours.\n\nConfirming lets us attach any bookings you already made as a guest with this address to your account.\n\nThe SAFRA team',
  },
  accountExists: {
    subject: 'Account sign-up attempt — SAFRA',
    body: 'Somebody tried to create a SAFRA account with this email address, and you already have one.\n\nIf that was you, sign in here:\n{signInUrl}\n\nForgotten your password? Reset it here:\n{resetUrl}\n\nIf it was not you, there is nothing to do — nothing about your account has changed and nobody saw your details.\n\nThe SAFRA team',
  },
  /** The staff roles, for the invitation. See `ar.ts` for why the template takes a code. */
  roles: {
    super_admin: 'Super admin',
    operations_manager: 'Operations manager',
    finance_officer: 'Finance officer',
    support_agent: 'Support agent',
  } as Record<string, string>,

  staffInvitation: {
    subject: 'You have been invited to the SAFRA admin console',
    body: 'You have been invited to the SAFRA admin console as: {roleLabel}.\n\nOpen this link to set your password:\n{url}\n\nThe link expires in {expiresInHours} hours and can be used once.\n\nAfter setting a password you will be required to enable two-factor authentication before the account can be used.\n\nIf you were not expecting this invitation, do not open the link and tell the SAFRA team.\n\nThe SAFRA team',
  },

  /* ── Joining as a partner (Bashar, 2026-08-19) ── */

  partnerApplicationReceived: {
    subject: 'We have your partnership request — {reference}',
    body: 'Thank you for your interest in partnering with SAFRA.\n\nYour request number: {reference}\n\nOur team will call you on the number you gave us to confirm the details of your business. After that call the request is reviewed, and if it is accepted we will send you the partnership contract and a link to create your partner account.\n\nKeep the request number — it is how we find your request if you contact us.\n\nThe steps and the documents we will ask for are set out here:\n{url}\n\nThe SAFRA team',
  },
  partnerApplicationRejected: {
    subject: 'About your partnership request — {reference}',
    body: 'Thank you for your time and for your interest in SAFRA.\n\nAfter reviewing request {reference} we are not able to proceed at this time.\n\nReason:\n{reason}\n\nIf any of that changes, you are welcome to apply again here:\n{url}\n\nThe SAFRA team',
  },
  partnerInvitation: {
    subject: 'Your partnership request was accepted — create your partner account',
    body: 'Partnership request {reference} has been accepted. Welcome to SAFRA.\n\nOpen the link below to set your account password:\n{url}\n\nThe link expires in {expiresInHours} hours and can be used once. After setting a password you will be asked to enrol in two-factor authentication, which is mandatory for partner accounts.\n\nWe will never send you a password in a message. If you receive one, it is not from us.\n\nYour account stays under review until our team has checked your documents and the signed contract. Until then you can prepare your property details; you cannot add prices, dates or images.\n\nIf you did not apply to become a partner, do not open the link and tell us.\n\nThe SAFRA team',
  },

  /** The contract KINDS, in the reader's language — `partner_contract_kind` in the schema. */
  contractKinds: {
    base: 'partnership agreement',
    commission_annex: 'commission annex',
    renewal: 'annual renewal',
  } as Record<string, string>,

  partnerContractReady: {
    subject: 'Your partnership contract is ready to sign — {partner}',
    body: 'Our team has uploaded your partnership contract ({kind}).\n\nYou can read and download it from your partner dashboard:\n{url}\n\nOnce you have signed it, return the signed copy to our team so the signature can be recorded and the contract becomes active.\n\nThe SAFRA team',
  },

  reviewReceived: {
    subject: 'New review for {property} — SAFRA',
    body: 'A guest who stayed at {property} has left a review.\n\nRating: {rating} out of 5\n\nYou can read it and reply from your partner dashboard:\n{url}\n\nYour reply appears publicly beneath the review. A review cannot be deleted or edited — not by the guest and not by SAFRA (principle P-006) — so replying is the only way to put your side.\n\nThe SAFRA team',
  },
  reviewReplied: {
    subject: 'The host replied to your review of {property} — SAFRA',
    body: 'The host has replied to the review you wrote about {property}.\n\nYou can read the reply on the property page:\n{url}\n\nThe SAFRA team',
  },
  bookingNeedsAction: {
    subject: 'A booking is waiting for you — {reference}',
    body: 'You have a new booking request waiting for your decision.\n\nReference: {reference}\nProperty: {property}\nCheck-in: {checkIn}\nCheck-out: {checkOut}\n\nYou have until {deadline} to respond. A request left unanswered past that time is cancelled automatically and a "no response" violation is recorded against your account.\n\nOpen the request here:\n{url}\n\nThe SAFRA team',
  },
  giftCardPurchased: {
    subject: 'Your gift card {reference} — SAFRA',
    body: 'A gift card for {amount} has been issued.\n\nCard code:\n{code}\n\nCard number: {reference}\n\nKeep this code somewhere safe. Whoever holds it can add the balance to their wallet, and we cannot send it again — we do not keep a copy.\n\nTo redeem it: open «Gift cards» in your account and enter the code:\n{url}\n\nThe SAFRA team',
  },
  giftCardReceived: {
    subject: 'A SAFRA gift card is waiting for you',
    body: 'Hello,\n\nSomeone has bought you a SAFRA gift card for {amount}.\n\nCard code:\n{code}\n\nCard number: {reference}\n\nKeep this code somewhere safe. Whoever holds it can add the balance to their wallet, and we cannot send it again — we do not keep a copy.\n\nTo add it to your wallet:\n{url}\n\nThe SAFRA team',
  },
  supportReplied: {
    subject: 'The support team replied to your request — {reference}',
    body: 'The SAFRA support team has replied to your support request.\n\nReference: {reference}\n\nOpen the conversation to read the reply and continue it:\n{url}\n\nWe do not send message text by email; the whole conversation is in your account.\n\nThe SAFRA team',
  },
  /**
   * The re-drive notice: something was waiting for you and we could not say exactly what.
   *
   * Sent only by `NotificationService.redrive`, when a notification row survived a total loss of
   * the queue. The row records THAT somebody was to be told and who — it deliberately holds no
   * recipient, subject or body (every support agent reads that table) — so a re-driven notice
   * cannot name the review, the reply or the thread it was originally about.
   *
   * Saying that plainly and pointing at the right screen is the honest version. The alternative
   * was silence, which is what happened before this existed.
   */
  waiting: {
    subject: 'You have an update waiting in your SAFRA account',
    body: 'Something in your SAFRA account was updated and we were not able to email you at the time.\n\nOpen this page to see it:\n{url}\n\nWe do not repeat the details by email — they are in your account.\n\nThe SAFRA team',
  },
} as const;
