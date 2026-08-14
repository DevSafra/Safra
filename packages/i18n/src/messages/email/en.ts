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
