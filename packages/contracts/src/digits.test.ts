import { describe, expect, it } from 'vitest';

import { campaignCreateSchema } from './advertising.js';
import { loginSchema } from './auth.js';
import { bookingCompensationSchema, bookingVerificationSchema } from './booking.js';
import { couponCreateSchema } from './coupon.js';
import { typedDigits, type TypedField } from './digits.js';
import { violationFineSchema } from './enforcement.js';
import { setFxRateSchema } from './fx.js';
import { giftCardIssueSchema } from './gift-card.js';
import { createLandmarkSchema } from './landmark.js';
import { payoutAccountInputSchema } from './payout-account.js';
import { propertyCreateSchema } from './property.js';
import { safraPayoutAccountInputSchema, safraPayoutOpenSchema } from './safra-payout.js';
import { totpCodeSchema } from './two-factor.js';
import { walletAdjustSchema } from './wallet.js';

/**
 * Arabic-Indic and Persian digits on every typed numeric field the API parses (audit 2026-10-06).
 *
 * The console and the portal normalise as the reader types, but the endpoint is the control: each
 * field below refused «٢٠٠» outright before `digitString`, so a replayed request or any client that
 * did not normalise met a refusal for a number the console would have taken as «200».
 */
const FIELDS = [
  ['ad price', campaignCreateSchema.shape.priceAmount, '١٢٠٫٥', '120.5'],
  ['staff TOTP', loginSchema.shape.totpCode, '١٢٣٤٥٦', '123456'],
  ['partner email code', loginSchema.shape.emailCode, '۱۲۳۴۵۶', '123456'],
  ['compensation', bookingCompensationSchema.shape.amount, '٥٠', '50'],
  ['booking verification code', bookingVerificationSchema.shape.code, '٠٠٤٢١٩', '004219'],
  ['coupon value', couponCreateSchema.shape.value, '١٥', '15'],
  ['fine', violationFineSchema.shape.amount, '٢٥٠٫٥', '250.5'],
  ['fine compensation', violationFineSchema.shape.customerCompensation, '۵۰', '50'],
  ['exchange rate', setFxRateSchema.shape.rate, '١٣٠٠٠', '13000'],
  ['gift card', giftCardIssueSchema.shape.amount, '١٠٠', '100'],
  ['enrolment TOTP', totpCodeSchema, '٩٨٧٦٥٤', '987654'],
  ['wallet adjustment', walletAdjustSchema.shape.amount, '١٠٫٢٥', '10.25'],
  ['landmark latitude', createLandmarkSchema.shape.latitude, '٣٣٫٥١٣٨', '33.5138'],
  ['listing latitude', propertyCreateSchema.shape.latitude, '٣٣٫٥١٣٨', '33.5138'],
  [
    'partner payout account',
    payoutAccountInputSchema.shape.accountNumber,
    '٠٩٤٤ ١٢٣ ٤٥٦',
    '0944123456',
  ],
  [
    'SAFRA payout account',
    safraPayoutAccountInputSchema.shape.accountNumber,
    '٠٩٤٤١٢٣٤٥٦',
    '0944123456',
  ],
  [
    'SAFRA payout period',
    safraPayoutOpenSchema.shape.periodStart,
    '٢٠٢٦-١٠-٠١',
    '2026-10-01',
  ],
] as const;

describe('typed numeric fields read Arabic and Persian digits', () => {
  it.each(FIELDS)('%s', (_name, schema, typed, expected) => {
    expect(schema.safeParse(typed)).toStrictEqual({ success: true, data: expected });
  });

  /* The opposite control: normalising must not turn the field into one that accepts anything. */
  it.each(FIELDS)('%s still refuses what is not a number', (_name, schema) => {
    expect(schema.safeParse('عشرون').success).toBe(false);
  });
});

/**
 * A field with a caret, standing in for an `<input>` without needing a DOM.
 *
 * Assigning `value` moves the caret to the end, as a browser does, so the test can tell a restored
 * caret from one that was never touched.
 */
function field(
  initial: string,
  caret: number | null,
): TypedField & { caret: number | null } {
  let current = initial;
  const selectable = caret !== null;

  return {
    caret,
    get value() {
      return current;
    },
    set value(next: string) {
      current = next;
      if (selectable) this.caret = next.length;
    },
    get selectionStart() {
      return this.caret;
    },
    get selectionEnd() {
      return this.caret;
    },
    setSelectionRange(start: number) {
      this.caret = start;
    },
  };
}

describe('typedDigits', () => {
  it('rewrites the field itself, so a pattern, a check and the request body agree', () => {
    const input = field('١٢٥٠', 4);

    expect(typedDigits(input)).toBe('1250');
    expect(input.value).toBe('1250');
  });

  /* Correcting a digit mid-number must not throw the caret to the end. */
  it('keeps the caret where the reader left it', () => {
    const input = field('1٢50', 2);

    typedDigits(input);

    expect(input.caret).toBe(2);
  });

  it('leaves a field with no selection API alone apart from its value', () => {
    const input = field('٧', null);

    expect(typedDigits(input)).toBe('7');
    expect(input.caret).toBeNull();
  });
});
