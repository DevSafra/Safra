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
  staffInvitation: {
    subject: 'You have been invited to the SAFRA admin console',
    body: 'You have been invited to the SAFRA admin console as: {roleLabel}.\n\nOpen this link to set your password:\n{url}\n\nThe link expires in {expiresInHours} hours and can be used once.\n\nAfter setting a password you will be required to enable two-factor authentication before the account can be used.\n\nIf you were not expecting this invitation, do not open the link and tell the SAFRA team.\n\nThe SAFRA team',
  },
} as const;
