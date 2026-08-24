import { describe, expect, it } from 'vitest';

import { VIOLATION_KINDS } from '@safra/contracts';

import { adminMessages } from './admin.js';
import { partnerMessages } from './partner.js';

/**
 * Every violation kind explains itself, on both screens, in the same terms.
 *
 * ## What this is written against
 *
 * Bashar reported twice that the descriptions were missing on المخالفات. The cause was that only a
 * HAND-RAISED violation carries one: `sla.service.ts` levies `no_response` and fines for it,
 * `booking-actions.service.ts` records `rejected_after_payment`, and neither writes a word. So the
 * violations that cost a partner money were exactly the ones with no explanation.
 *
 * The fix is a sentence per KIND, resolved at render time rather than stored — a generated sentence
 * written into the row would be frozen in whichever language the sweep picked, which is «No
 * user-facing text is written inside code» defeated one layer down, in the database, where no lint
 * rule can see it.
 *
 * ## Why the catalogues are checked against the ENUM and against each other
 *
 * There are two: the partner reads one and the operator reads the other, worded differently on
 * purpose — «لم يصل ردّ» to the business it happened to, «لم يرد الشريك» to the staff member
 * reviewing it. Two catalogues describing one set of events is precisely where a sixth kind gets
 * added to one and not the other, and the screen that lacks it silently shows nothing. The enum is
 * the authority for what exists; these assert both sides cover it.
 */
describe('every violation kind has a description for both readers', () => {
  const partner = partnerMessages('ar').violations;
  const admin = adminMessages('ar').enums;

  it.each([...VIOLATION_KINDS])('the partner is told what %s means', (kind) => {
    expect(
      partner.defaultDescription[kind],
      `مخالفات would show this kind with no explanation. Add it to ` +
        `violations.defaultDescription in messages/partner/ar.ts.`,
    ).toBeTruthy();
  });

  it.each([...VIOLATION_KINDS])('the operator is told what %s means', (kind) => {
    expect(
      admin.violationDefaultDescription[kind],
      `The console would show this kind with no explanation, on the screen where a waiver is ` +
        `decided. Add it to enums.violationDefaultDescription in messages/admin/ar.ts.`,
    ).toBeTruthy();
  });

  /**
   * A kind whose sentence names a booking must have a variant that does not.
   *
   * `{reference}` is filled from the violation, and `booking_id` is nullable — stale-calendar
   * violations have none. A sentence with an unfilled placeholder would print the literal
   * `{reference}` to a partner; one that says «الحجز —» is worse than one that omits it.
   */
  it.each([...VIOLATION_KINDS])('%s can be worded without a booking', (kind) => {
    for (const [side, withBooking, withoutBooking] of [
      ['partner', partner.defaultDescription, partner.defaultDescriptionNoBooking],
      [
        'admin',
        admin.violationDefaultDescription,
        admin.violationDefaultDescriptionNoBooking,
      ],
    ] as const) {
      const sentence = withBooking[kind] ?? '';

      if (!sentence.includes('{reference}')) continue;

      expect(
        withoutBooking[kind],
        `${side}: "${kind}" names a booking, so it needs a variant that does not — its ` +
          `booking_id is nullable and the placeholder would reach a reader unfilled.`,
      ).toBeTruthy();
    }
  });

  /** And no catalogue carries a sentence for a kind the enum does not have. */
  it('has no description for a kind that does not exist', () => {
    const declared = new Set<string>(VIOLATION_KINDS);
    const orphans = [
      ...Object.keys(partner.defaultDescription),
      ...Object.keys(admin.violationDefaultDescription),
    ].filter((kind) => !declared.has(kind));

    expect(
      orphans,
      'These describe a violation kind nothing can record — either the name is wrong or the kind ' +
        'was removed.',
    ).toStrictEqual([]);
  });
});
