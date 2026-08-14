import { describe, expect, it } from 'vitest';

import { ERROR } from './error-codes.js';
import { passwordChangeSchema, profileUpdateSchema } from './auth.js';

/**
 * The two schemas behind الملف الشخصي's writes.
 *
 * Tested at the contract level because these are the rules the API enforces on EVERY caller — the web
 * form, a future mobile client, curl. A rule proven only through a form is a rule that holds only for
 * that form.
 */
describe('profileUpdateSchema', () => {
  it.each([
    [{ fullName: 'رامي الحمصي' }],
    [{ phone: '+963900000001' }],
    [{ fullName: 'رامي', phone: '+963900000001' }],
  ])('accepts %j', (input) => {
    expect(profileUpdateSchema.safeParse(input).success).toBe(true);
  });

  /* An empty PATCH is a mistake worth reporting, not a successful no-op. */
  it('refuses an empty body', () => {
    const result = profileUpdateSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      ERROR.VALIDATION_ONE_FIELD_REQUIRED,
    );
  });

  /**
   * EMAIL is not editable here, and `.strict()` is what says so.
   *
   * Changing the address somebody signs in with has to prove they hold the new one — a verification
   * flow, not a field. Without `.strict()` this would be silently ignored, which is the worst of the
   * three possible behaviours.
   */
  it('refuses an attempt to change the email', () => {
    expect(profileUpdateSchema.safeParse({ email: 'new@safra.test' }).success).toBe(
      false,
    );
  });

  it('refuses an unknown field rather than ignoring it', () => {
    expect(
      profileUpdateSchema.safeParse({ fullName: 'رامي', role: 'super_admin' }).success,
    ).toBe(false);
  });

  it.each(['a', '', ' '])('refuses the too-short name %j', (fullName) => {
    expect(profileUpdateSchema.safeParse({ fullName }).success).toBe(false);
  });

  it('trims a name rather than storing the padding', () => {
    const result = profileUpdateSchema.safeParse({ fullName: '  رامي  ' });

    expect(result.success && result.data.fullName).toBe('رامي');
  });

  it.each(['0900000001', '963900000001', '+0900000001', '+96390000000123456', 'phone'])(
    'refuses the malformed phone %j',
    (phone) => {
      expect(profileUpdateSchema.safeParse({ phone }).success).toBe(false);
    },
  );
});

describe('passwordChangeSchema', () => {
  /*
    Both meet the composition checklist — uppercase, lowercase, digit, symbol, twelve characters.
    This suite is about the SHAPE of the change request, so the passwords must not be what fails.
  */
  const valid = { currentPassword: 'The-Old-One-12', newPassword: 'A-Brand-New-One-13' };

  it('accepts a current password and a compliant new one', () => {
    expect(passwordChangeSchema.safeParse(valid).success).toBe(true);
  });

  /**
   * The current password is REQUIRED, and that is the security value of the whole endpoint.
   *
   * A leaked access token must not be enough to lock the owner out of their own account.
   */
  it('refuses a body with no current password', () => {
    expect(
      passwordChangeSchema.safeParse({ newPassword: valid.newPassword }).success,
    ).toBe(false);
  });

  it('applies the same length policy as registration', () => {
    const result = passwordChangeSchema.safeParse({
      currentPassword: 'The-Old-One-12',
      newPassword: 'short',
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      ERROR.VALIDATION_PASSWORD_TOO_SHORT,
    );
  });

  /* Re-setting the same password is a no-op dressed as a security action. */
  it('refuses a new password identical to the current one', () => {
    const same = 'the-very-same-12';
    const result = passwordChangeSchema.safeParse({
      currentPassword: same,
      newPassword: same,
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      ERROR.VALIDATION_PASSWORD_UNCHANGED,
    );
  });

  it('refuses an unknown field', () => {
    expect(
      passwordChangeSchema.safeParse({ ...valid, userId: 'somebody-else' }).success,
    ).toBe(false);
  });

  /**
   * A password is never trimmed.
   *
   * Leading or trailing spaces are legitimate characters in a passphrase, and silently removing them
   * would mean the password somebody typed is not the one that was stored.
   */
  it('keeps surrounding whitespace in a password', () => {
    /* Uppercase, digit and symbol, so the COMPOSITION rules are met and whitespace is the subject. */
    const padded = '  A Padded Passphrase 9!  ';
    const result = passwordChangeSchema.safeParse({
      currentPassword: 'The-Old-One-12',
      newPassword: padded,
    });

    expect(result.success && result.data.newPassword).toBe(padded);
  });
});
