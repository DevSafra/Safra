/** Transactional email copy in English. */
export const en = {
  bookingRecovery: {
    subject: 'Your SAFRA bookings',
    body: 'You asked us to send your SAFRA booking references.\n\n{references}\n\nOpen any of them from your account, or quote the number to our support team.\n\nIf you did not ask for this, ignore this message — nothing has changed and nobody has seen your details.\n\nThe SAFRA team',
  },
  bookingRecoveryNone: {
    subject: 'Your SAFRA bookings',
    body: 'You asked us to send your SAFRA booking references.\n\nThere are no bookings attached to this email address.\n\nIf you booked with a different address, try that one. If you believe this is wrong, contact support.\n\nThe SAFRA team',
  },
  bookingVerification: {
    subject: 'Your verification code — SAFRA',
    body: 'A SAFRA staff member has asked to verify your identity before discussing booking {reference}.\n\nVerification code: {code}\n\nIt expires in {minutes} minutes. Read it only to the person you are speaking to right now.\n\nIf you are not on a call with SAFRA, ignore this message and give the code to nobody — nothing about your booking has been disclosed.\n\nThe SAFRA team',
  },
  bookingConfirmed: {
    subject: 'Your booking is confirmed — {reference}',
    body: 'Your SAFRA booking is confirmed.\n\nBooking number: {reference}\nProperty: {property}\nCheck-in: {checkIn}\nCheck-out: {checkOut}\n\nYour voucher is attached, with a QR code for verification on arrival. Show it, or quote the booking number to your host.\n\nThe SAFRA team',
  },
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

  /* ── Suspending and reinstating a staff account (Bashar, 2026-08-23) ── */

  /* ── Suspending a partner account (Bashar, 2026-08-24) ── */

  partnerFineWaived: {
    subject: 'A fine on your account has been waived',
    body: 'The SAFRA team has reviewed the fine on your account and decided to waive it.\n\nAmount: {amount}\nDate waived: {date}\n\nReason:\n{reason}\n\nYou will not be charged this amount. The original violation remains recorded on your account with the waiver recorded beside it — we do not delete the record, we add to it, so what happened stays clear to you and to us.\n\nYou can review the violation and the waiver here:\n{url}\n\nThe SAFRA team',
  },
  disputeResolved: {
    subject: 'A decision on your dispute for booking {booking}',
    body: 'We reviewed your complaint about booking {booking} and decided it in your favour.\n\nDispute reference: {reference}\nDecided on: {date}\n\nThe decision:\n{resolution}\n\nIf the decision includes compensation, it has been added to your SAFRA wallet and can be used on any future booking.\n\nYou can read the booking and the dispute in full in your account:\n{url}\n\nWe are sorry this happened, and thank you for telling us.\n\nThe SAFRA team',
  },
  disputeRejected: {
    subject: 'A decision on your dispute for booking {booking}',
    body: 'We reviewed your complaint about booking {booking} and did not find enough to uphold it.\n\nDispute reference: {reference}\nDecided on: {date}\n\nThe decision:\n{resolution}\n\nIf there is anything more to add — photographs, messages, any detail that did not reach us — contact support from your account and we will look again.\n\nThe booking and the dispute are in your account:\n{url}\n\nThe SAFRA team',
  },
  disputePayoutReleased: {
    subject: 'The dispute on booking {booking} is closed',
    body: 'The dispute opened on booking {booking} has been closed, and the hold on your payout for it has been lifted.\n\nDispute reference: {reference}\nClosed on: {date}\n\nWhat this means: the payout for this booking was held while the dispute was open, and it is now in the ordinary transfer cycle. Nothing was cancelled because the dispute was opened.\n\nThe booking is in your partner console:\n{url}\n\nThe SAFRA team',
  },
  partnerWarned: {
    subject: 'A warning has been issued on your account',
    body: 'A formal warning has been issued on your SAFRA partner account.\n\nDate of warning: {date}\n\nThe warning:\n{note}\n\nA warning is a record on your account. It carries no charge, and it does not affect where your listings rank in search. Confirmed bookings stand and your guests are unaffected.\n\nYou can read the violation and its full detail in the partner portal:\n{url}\n\nTo appeal or ask a question, contact the SAFRA team through support in the partner portal.\n\nThe SAFRA team',
  },
  partnerFined: {
    subject: 'A fine has been charged to your account',
    body: 'A fine has been charged to your SAFRA partner account.\n\nAmount: {amount}\nDate of fine: {date}\n\nReason:\n{reason}\n\nA fine does not affect where your listings rank in search, and confirmed bookings stand.\n\nYou can read the violation and the fine in full in the partner portal:\n{url}\n\nIf you believe this fine was charged in error, contact the SAFRA team through support in the partner portal.\n\nThe SAFRA team',
  },
  partnerUnsuspended: {
    subject: 'Your partner account has been reinstated',
    body: 'The suspension on your SAFRA partner account has been lifted and the account is fully active again.\n\nDate lifted: {date}\n\nReason:\n{reason}\n\nWhat is back:\n- Your listings appear in search again and new bookings can be made.\n- Payouts resume. Anything frozen during the suspension was held, not cancelled.\n- You can add new properties, and publish and edit existing ones.\n\nThe suspension stays on your record with the decision to lift it beside it — we do not delete the record, we add to it.\n\nPartner portal:\n{url}\n\nThe SAFRA team',
  },
  partnerSuspended: {
    subject: 'Your partner account has been suspended',
    body: 'Your SAFRA partner account has been suspended.\n\nDate of suspension: {date}\n\nReason:\n{reason}\n\nWhat this means:\n- Your listings will not appear in search, and no new bookings can be made.\n- **Confirmed bookings stand and your current guests are unaffected.** Host them as normal.\n- Payouts are frozen while the suspension is in force.\n- You cannot add new properties, or publish or edit existing ones.\n\nYou can still sign in to the partner portal, view your account and read this reason at any time:\n{url}\n\nTo appeal or ask a question, contact the SAFRA team through support in the partner portal.\n\nThe SAFRA team',
  },
  staffSuspended: {
    subject: 'Your SAFRA console account has been disabled',
    body: 'Your SAFRA console account has been disabled and you can no longer sign in. Any sessions you had open on any device have been ended.\n\nThe account has not been deleted and none of your data has been lost. Disabling is reversible, and an administrator can reinstate the account at any time.\n\nIf you believe this happened by mistake, contact a SAFRA administrator directly — this cannot be resolved from the sign-in screen.\n\nThe SAFRA team',
  },
  staffReinstated: {
    subject: 'Your SAFRA console account has been reinstated',
    body: 'Your SAFRA console account has been reinstated and you can sign in again:\n{url}\n\nYou will need to sign in again on every device, because your earlier sessions were ended when the account was disabled.\n\nYour role and permissions are exactly as they were before; neither was changed.\n\nThe SAFRA team',
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
  partnerLoginCode: {
    subject: 'Your sign-in code — SAFRA',
    body: 'Your code for the partner portal:\n\n{code}\n\nIt expires in {expiresInMinutes} minutes and can be used once.\n\nIf you did not try to sign in, ignore this message and change your password — whoever asked for this code knows your current one.\n\nThe SAFRA team will never ask you for this code, by phone or by message.\n\nThe SAFRA team',
  },

  partnerInvitation: {
    subject: 'Your partnership request was accepted — create your partner account',
    body: 'Partnership request {reference} has been accepted. Welcome to SAFRA.\n\nOpen the link below to set your account password:\n{url}\n\nThe link expires in {expiresInHours} hours and can be used once. After setting a password you can sign in straight away. Each time you sign in we email a six-digit code to this address, and you enter it to finish signing in.\n\nWe will never send you a password in a message. If you receive one, it is not from us.\n\nYour account stays under review until our team has checked your documents and the signed contract. Until then you can prepare your property details; you cannot add prices, dates or images.\n\nIf you did not apply to become a partner, do not open the link and tell us.\n\nThe SAFRA team',
  },

  /** The contract KINDS, in the reader's language — `partner_contract_kind` in the schema. */
  contractKinds: {
    base: 'partnership agreement',
    commission_annex: 'commission annex',
    renewal: 'annual renewal',
  } as Record<string, string>,

  partnerApproved: {
    subject: 'Your SAFRA account is approved — {reference}',
    body: 'Congratulations — your account has been verified and you are now an approved SAFRA partner.\n\nThe partner portal is open in full: you can add units, prices, availability and photographs, and submit your listings for review before they are published.\n\nOpen the partner portal:\n{url}\n\nThe SAFRA team',
  },

  partnerContractAwaitingSignature: {
    subject: 'Your partnership agreement is ready to sign — {reference}',
    body: 'SAFRA has signed the partnership agreement and sent it to you.\n\nOpen «العقود والمستندات» in the partner portal, download the contract, sign it by hand, then upload the signed copy from the same page.\n\n{url}\n\nThe agreement takes effect once your signed copy arrives.\n\nThe SAFRA team',
  },

  partnerEmployeeInvitation: {
    subject: 'An invitation to join the {partnerName} team on SAFRA',
    body: '{partnerName} has invited you to work with them on the SAFRA platform.\n\nOpen the link below to set your password and activate your account. It is valid for {hours} hours:\n{url}\n\nIf you were not expecting this invitation, ignore this message and no account will be created for you.\n\nThe SAFRA team',
  },

  partnerContractCountersigned: {
    subject: 'Your copy of the signed partnership agreement — {reference}',
    body: 'Both parties have signed the partnership agreement and it is now in force.\n\nYour copy is kept on the Contracts and documents page of your partner dashboard, and you can download it at any time:\n{url}\n\nThe SAFRA team',
  },

  partnerContractReturned: {
    subject: 'Partner returned a signed contract — {reference}',
    body: 'The partner {displayName} ({reference}) has returned the partnership agreement signed by hand, and it is now in force.\n\nOpen the partner to review the signed copy and continue:\n{url}\n\nSAFRA console',
  },

  partnerDocumentsComplete: {
    subject: 'Partner documents awaiting review — {reference}',
    body: 'The partner {displayName} ({reference}) has sent every required document, and they are waiting to be reviewed.\n\nDocuments sent: {documentCount}\n\nOpen the partner to review them:\n{url}\n\nSAFRA console',
  },

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
  bookingCancelledBySafra: {
    subject: 'Your booking {reference} was cancelled — SAFRA',
    body: 'We are sorry: the partner did not confirm your booking within the deadline, so SAFRA cancelled it.\n\nReference: {reference}\nProperty: {property}\nCheck-in: {checkIn}\nCheck-out: {checkOut}\n\nWe are returning the full amount of {amount} {currency}. The refund starts automatically and may take a few days to reach your account, depending on the payment method.\n\nWe have also added {compensation} {currency} to your wallet as compensation.\n\nFind an alternative stay for the same dates here:\n{url}\n\nThe SAFRA team',
  },
  bookingRefunded: {
    subject: 'A refund has started for booking {reference} — SAFRA',
    body: 'We have started refunding your booking.\n\nReference: {reference}\nAmount refunded: {amount} {currency}\n\nAnything returning to your wallet is there immediately. Anything returning via your payment method may take a few days to appear.\n\nBooking details:\n{url}\n\nThe SAFRA team',
  },
  bookingInvoice: {
    subject: 'Your invoice for booking {reference} — SAFRA',
    body: 'We have received your payment. This is the invoice for your booking.\n\nReference: {reference}\nProperty: {property}\nTotal paid: {amount} {currency}\n\nOpen or download your invoice here:\n{url}\n\nThe SAFRA team',
  },
  bookingDeadlineReminder: {
    subject: '30 minutes left to answer booking {reference} — SAFRA',
    body: 'A reminder: the window to answer this booking is about to close.\n\nReference: {reference}\nProperty: {property}\nCheck-in: {checkIn}\nCheck-out: {checkOut}\n\nDeadline: {deadline}. If the window closes with no answer the booking is cancelled automatically, the customer is refunded in full, and a «no response» violation is recorded against your account.\n\nOpen the request now:\n{url}\n\nThe SAFRA team',
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
