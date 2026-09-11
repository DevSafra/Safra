import { describe, expect, it } from 'vitest';

import { ANNOUNCEMENT_MAX_LENGTH, isAnnouncement } from './payment.js';

/**
 * The shape of the header banner a super admin writes.
 *
 * Bashar, 2026-09-11: the banner stays and «the super admin should be able to manage it example
 * hide/show and write the message himself». The words are therefore DATA, and this is the one
 * check standing between an operator's typing and a sentence on every page of the customer site.
 *
 * It is asserted here rather than only in the API because three surfaces read it — the validator,
 * the console's editor and the site's header — and a shape they disagree about is a banner that
 * renders in one place and not another.
 */
describe('the site announcement', () => {
  const valid = { ar: 'مرحباً', en: 'Hello', de: 'Hallo' };

  it('accepts a line for every language the site serves', () => {
    expect(isAnnouncement(valid)).toBe(true);
  });

  /**
   * An empty line is MEANINGFUL, not missing.
   *
   * It is how a notice written in Arabic and not yet translated stays off the German site, rather
   * than greeting a German reader in Arabic. Rejecting it would force an operator to invent a
   * translation or take the banner down for everybody.
   */
  it('accepts an empty line, which hides the banner from that language alone', () => {
    expect(isAnnouncement({ ar: 'مرحباً', en: '', de: '' })).toBe(true);
  });

  it('refuses a missing language, because a reader of it would see nothing or the wrong thing', () => {
    expect(isAnnouncement({ ar: 'مرحباً', en: 'Hello' })).toBe(false);
  });

  /**
   * A stray key is refused rather than ignored.
   *
   * Ignoring it would let `{ ar, en, de, fr }` through and store an unvalidated string in a row
   * every page of the site reads — the shape of defect where the guard passes and the data is
   * still wrong.
   */
  it('refuses a language it does not serve', () => {
    expect(isAnnouncement({ ...valid, fr: 'Bonjour' })).toBe(false);
  });

  it('refuses anything that is not a string', () => {
    expect(isAnnouncement({ ar: 'مرحباً', en: 'Hello', de: 42 })).toBe(false);
    expect(isAnnouncement({ ar: 'مرحباً', en: 'Hello', de: null })).toBe(false);
  });

  /**
   * The cap is what keeps a one-line bar one line.
   *
   * Measured rather than guessed: the Arabic notice is 42 characters and fits a 390px phone;
   * longer translations of the same sentence pushed the page sideways under `whitespace-nowrap`,
   * which the project forbids outright. 120 leaves room for a real sentence and refuses a
   * paragraph.
   */
  it('refuses a line longer than the bar can hold', () => {
    expect(isAnnouncement({ ...valid, en: 'x'.repeat(ANNOUNCEMENT_MAX_LENGTH) })).toBe(
      true,
    );
    expect(
      isAnnouncement({ ...valid, en: 'x'.repeat(ANNOUNCEMENT_MAX_LENGTH + 1) }),
    ).toBe(false);
  });

  it('refuses something that is not an object at all', () => {
    for (const value of [null, undefined, 'text', 42, ['ar']]) {
      expect(isAnnouncement(value)).toBe(false);
    }
  });
});
