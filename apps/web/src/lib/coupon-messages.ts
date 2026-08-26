import { ERROR } from '@safra/contracts';
import { errorMessage } from '@safra/i18n';

/**
 * Every `coupon.*` refusal, in the reader's language, keyed by CODE.
 *
 * ## Why the whole set travels to the browser
 *
 * A coupon refusal is a sentence somebody reads at the moment they are trying to pay, and the
 * codes are not interchangeable: «this coupon starts on Sunday» and «you have already used this»
 * are different problems with different answers. Resolving them here rather than in the client
 * component keeps the catalogue on the server — the field receives words, never a dictionary it
 * might fall out of step with.
 *
 * The English `message` the API sends alongside its code is for LOGS and is never displayed; this
 * is what the customer actually sees.
 */
export function couponMessages(locale: 'ar' | 'en' | 'de'): Record<string, string> {
  /*
    Derived from `ERROR` rather than from a list written here.

    A refusal added to the API and forgotten here would fall back to the general «that code could
    not be applied», which is the quiet failure this map exists to prevent — the customer is told to
    give up when the fix was to come back tomorrow. Taking the codes from the contract means a new
    one is translated the moment it has a catalogue entry.
  */
  const codes = Object.values(ERROR).filter((code) => code.startsWith('coupon.'));

  return Object.fromEntries(codes.map((code) => [code, errorMessage(code, locale)]));
}
